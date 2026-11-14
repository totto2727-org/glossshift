//! Latest-value shortcut intents. Replacing an intent cancels every pending step.

use crate::bridge_types::BridgeEvent;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct Intent {
    pub target: String,
    pub token: CancellationToken,
}

#[derive(Clone)]
pub struct Shortcuts {
    sender: watch::Sender<Option<Intent>>,
    pub stopped: CancellationToken,
}

impl Shortcuts {
    pub fn new() -> (Self, watch::Receiver<Option<Intent>>) {
        let (sender, receiver) = watch::channel(None);
        (
            Self {
                sender,
                stopped: CancellationToken::new(),
            },
            receiver,
        )
    }

    pub fn push(&self, target: String) {
        self.sender.send_modify(|current| {
            if let Some(previous) = current.take() {
                previous.token.cancel();
            }
            if !self.stopped.is_cancelled() {
                *current = Some(Intent {
                    target,
                    token: self.stopped.child_token(),
                });
            }
        });
    }

    pub fn close(&self) {
        self.stopped.cancel();
        self.sender.send_replace(None);
    }
}

pub async fn deliver(
    sender: &async_channel::Sender<BridgeEvent>,
    event: BridgeEvent,
    token: &CancellationToken,
) -> bool {
    tokio::select! {
        biased;
        () = token.cancelled() => false,
        result = sender.send(event) => result.is_ok() && !token.is_cancelled(),
    }
}

pub async fn run(
    mut receiver: watch::Receiver<Option<Intent>>,
    stopped: CancellationToken,
    service: std::sync::Arc<crate::services::Services>,
) {
    loop {
        tokio::select! {
            biased;
            () = stopped.cancelled() => break,
            changed = receiver.changed() => if changed.is_err() { break; },
        }
        let Some(intent) = receiver.borrow_and_update().clone() else {
            continue;
        };
        let token = &intent.token;
        tokio::select! {
            biased;
            () = token.cancelled() => continue,
            () = tokio::time::sleep(std::time::Duration::from_millis(100)) => (),
        }
        let result = tokio::select! {
            biased;
            () = token.cancelled() => continue,
            result = crate::desktop::capture_current(token.clone()) => result,
        };
        let id = service.next_id();
        let event = match result {
            Ok(text) => crate::services::Services::capture_event(id, text, intent.target),
            Err(message) => BridgeEvent::new(crate::bridge_types::EventKind::Failed, id, message),
        };
        if deliver(&service.control_sender, event, token).await {
            let _ = crate::desktop::reveal_current(token.clone()).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bridge_types::EventKind;
    use std::time::Duration;

    #[test]
    fn latest_intent_survives_many_shortcuts_without_a_receiver_drain() {
        let (shortcuts, mut receiver) = Shortcuts::new();
        shortcuts.push("first".into());
        let first = receiver
            .borrow_and_update()
            .clone()
            .unwrap_or_else(|| panic!("first intent missing"));
        for number in 0..100 {
            shortcuts.push(number.to_string());
        }
        assert!(first.token.is_cancelled());
        let latest = receiver
            .borrow_and_update()
            .clone()
            .unwrap_or_else(|| panic!("latest intent missing"));
        assert_eq!(latest.target, "99");
        assert!(!latest.token.is_cancelled());
        shortcuts.close();
        assert!(latest.token.is_cancelled());
        shortcuts.push("after shutdown".into());
        assert!(receiver.borrow_and_update().is_none());
    }

    #[tokio::test]
    async fn replacement_interrupts_full_capture_channel_without_delivering_stale_source()
    -> anyhow::Result<()> {
        let (shortcuts, mut receiver) = Shortcuts::new();
        let (sender, events) = async_channel::bounded(1);
        sender
            .send(BridgeEvent::new(EventKind::Capture, "occupied", ""))
            .await?;
        shortcuts.push("Japanese".into());
        let first = receiver
            .borrow_and_update()
            .clone()
            .ok_or_else(|| anyhow::anyhow!("intent missing"))?;
        let replace = async {
            tokio::task::yield_now().await;
            shortcuts.push("English".into());
        };
        let (delivered, ()) = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(
                deliver(
                    &sender,
                    BridgeEvent::new(EventKind::Capture, "old", "stale"),
                    &first.token
                ),
                replace
            )
        })
        .await?;
        assert!(!delivered, "cancelled capture must not reach reveal");
        assert_eq!(events.recv().await?.request_id, "occupied");
        assert!(events.try_recv().is_err(), "stale capture was queued");
        assert_eq!(
            receiver
                .borrow_and_update()
                .as_ref()
                .map(|intent| intent.target.as_str()),
            Some("English")
        );
        Ok(())
    }
}
