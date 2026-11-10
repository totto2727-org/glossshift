//! Convert the shared Rig stream to bounded, request-scoped TS events.

use crate::{
    bridge_types::{BridgeEvent, EventKind},
    llm::{self, TranslationEvent, TranslationRequest},
    services::Services,
};
use async_channel::{Receiver, Sender};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub async fn run(
    service: Arc<Services>,
    request: TranslationRequest,
    token: CancellationToken,
    id: String,
) {
    let request_id = request.id;
    let (sender, receiver) = async_channel::bounded(64);
    let translate = async {
        let outcome = tokio::select! {
            biased;
            () = token.cancelled() => return,
            result = llm::translate(request, sender.clone(), token.clone()) => result,
        };
        if let Err(error) = outcome {
            let event = TranslationEvent::Failed {
                id: request_id,
                message: public_error(&error).into(),
            };
            tokio::select! {
                () = token.cancelled() => (),
                _ = sender.send(event) => (),
            }
        }
    };
    tokio::join!(translate, forward(receiver, &service.sender, &id, &token));
    service.terminal(&id);
}

fn public_error(error: &anyhow::Error) -> &'static str {
    if error.is::<tokio::time::error::Elapsed>() {
        "Translation timed out. Please try again."
    } else {
        "Translation failed. Check the selected provider configuration and try again."
    }
}

async fn forward(
    receiver: Receiver<TranslationEvent>,
    sender: &Sender<BridgeEvent>,
    id: &str,
    token: &CancellationToken,
) {
    let mut sequence = 0_u32;
    loop {
        let event = tokio::select! {
            biased;
            () = token.cancelled() => break,
            event = receiver.recv() => match event { Ok(event) => event, Err(_) => break },
        };
        sequence = sequence.saturating_add(1);
        let (kind, text) = match event {
            TranslationEvent::Started { source_text, .. } => (EventKind::Started, source_text),
            TranslationEvent::Delta { text, .. } => (EventKind::Delta, text),
            TranslationEvent::Finished { .. } => (EventKind::Finished, String::new()),
            TranslationEvent::Failed { message, .. } => (
                EventKind::Failed,
                if message == "Translation timed out. Please try again." {
                    message
                } else {
                    "Translation failed. Check the selected provider configuration and try again."
                        .into()
                },
            ),
        };
        let terminal = matches!(kind, EventKind::Finished | EventKind::Failed);
        let mut event = BridgeEvent::new(kind, id, text);
        event.seq = sequence;
        tokio::select! {
            biased;
            () = token.cancelled() => break,
            result = sender.send(event) => if result.is_err() { break; },
        }
        if terminal {
            break;
        }
    }
    token.cancel();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::RequestId;
    use std::time::Duration;

    #[tokio::test]
    async fn typed_timeouts_keep_a_safe_actionable_message() -> anyhow::Result<()> {
        let elapsed = tokio::time::timeout(Duration::ZERO, std::future::pending::<()>())
            .await
            .err()
            .ok_or_else(|| anyhow::anyhow!("expected timeout"))?;
        let error = anyhow::Error::new(elapsed).context("SECRET_PROVIDER_CONTEXT");
        assert_eq!(
            public_error(&error),
            "Translation timed out. Please try again."
        );
        Ok(())
    }

    #[tokio::test]
    async fn provider_errors_never_expose_response_secrets() -> anyhow::Result<()> {
        let secret = "SECRET_API_KEY SECRET_HEADER_VALUE";
        let error = anyhow::anyhow!(secret).context("provider echoed request headers");
        assert!(!public_error(&error).contains("SECRET"));
        let (input, receiver) = async_channel::bounded(1);
        let (output, events) = async_channel::bounded(1);
        input
            .send(TranslationEvent::Failed {
                id: RequestId(1),
                message: secret.into(),
            })
            .await?;
        forward(receiver, &output, "request", &CancellationToken::new()).await;
        let event = events.recv().await?;
        assert_eq!(event.kind, EventKind::Failed);
        assert_eq!(event.text, public_error(&error));
        assert!(!event.text.contains("SECRET"));
        Ok(())
    }

    #[tokio::test]
    async fn stream_keeps_wire_id_sequence_and_terminal_boundary() -> anyhow::Result<()> {
        let (input, receiver) = async_channel::bounded(8);
        let (output, events) = async_channel::bounded(8);
        let token = CancellationToken::new();
        for event in [
            TranslationEvent::Started {
                id: RequestId(7),
                source_text: "source".into(),
            },
            TranslationEvent::Delta {
                id: RequestId(7),
                text: "first".into(),
            },
            TranslationEvent::Delta {
                id: RequestId(7),
                text: " second".into(),
            },
            TranslationEvent::Finished { id: RequestId(7) },
            TranslationEvent::Delta {
                id: RequestId(7),
                text: "late".into(),
            },
        ] {
            input.send(event).await?;
        }
        forward(receiver, &output, "ui-request", &token).await;
        let mut actual = Vec::new();
        while let Ok(event) = events.try_recv() {
            actual.push(event);
        }
        assert_eq!(actual.len(), 4);
        assert!(actual.iter().all(|event| event.request_id == "ui-request"));
        assert_eq!(
            actual.iter().map(|event| event.seq).collect::<Vec<_>>(),
            [1, 2, 3, 4]
        );
        assert_eq!(actual[1].text.clone() + &actual[2].text, "first second");
        assert_eq!(actual[3].kind, EventKind::Finished);
        assert!(token.is_cancelled());
        Ok(())
    }

    #[tokio::test]
    async fn cancellation_interrupts_full_output_backpressure() -> anyhow::Result<()> {
        let (input, receiver) = async_channel::bounded(2);
        let (output, _events) = async_channel::bounded(1);
        let token = CancellationToken::new();
        output
            .send(BridgeEvent::new(EventKind::Started, "old", ""))
            .await?;
        input
            .send(TranslationEvent::Delta {
                id: RequestId(1),
                text: "blocked".into(),
            })
            .await?;
        let cancel = async {
            tokio::task::yield_now().await;
            token.cancel();
        };
        tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(forward(receiver, &output, "request", &token), cancel);
        })
        .await?;
        Ok(())
    }

    #[tokio::test]
    async fn closed_ui_channel_cancels_provider() -> anyhow::Result<()> {
        let (input, receiver) = async_channel::bounded(1);
        let (output, events) = async_channel::bounded(1);
        drop(events);
        let token = CancellationToken::new();
        input
            .send(TranslationEvent::Delta {
                id: RequestId(1),
                text: "delta".into(),
            })
            .await?;
        forward(receiver, &output, "request", &token).await;
        assert!(token.is_cancelled());
        Ok(())
    }
}
