use std::sync::Arc;

use anyhow::Context as _;
use async_channel::{Receiver, Sender};
use futures::{StreamExt as _, pin_mut};
use llm_profiles::LoadedAgentsConfig;
use rig::{
    agent::MultiTurnStreamItem,
    streaming::{StreamedAssistantContent, StreamingPrompt},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::prompt::{translation_system_prompt, translation_user_prompt};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestId(pub u64);

pub struct TranslationRequest {
    pub id: RequestId,
    pub agents: Arc<LoadedAgentsConfig>,
    pub source_language: String,
    pub target_language: String,
    pub text: String,
}

#[derive(Debug)]
pub enum TranslationEvent {
    Started { id: RequestId, source_text: String },
    Delta { id: RequestId, text: String },
    Finished { id: RequestId },
    Failed { id: RequestId, message: String },
}

impl TranslationEvent {
    #[must_use]
    pub const fn request_id(&self) -> RequestId {
        match self {
            Self::Started { id, .. }
            | Self::Delta { id, .. }
            | Self::Finished { id }
            | Self::Failed { id, .. } => *id,
        }
    }
}

pub async fn run_worker(requests: Receiver<TranslationRequest>, events: Sender<TranslationEvent>) {
    let mut active: Option<CancellationToken> = None;
    while let Ok(request) = requests.recv().await {
        if let Some(token) = active.take() {
            token.cancel();
        }
        let token = CancellationToken::new();
        active = Some(token.clone());
        let events = events.clone();
        tokio::spawn(async move {
            let id = request.id;
            if let Err(error) = translate(request, events.clone(), token).await {
                let _ = events
                    .send(TranslationEvent::Failed {
                        id,
                        message: format!("{error:#}"),
                    })
                    .await;
            }
        });
    }
}

/// Stream one translation request into the supplied event channel.
///
/// # Errors
/// Returns an error when the provider cannot be streamed or reported to the receiver.
pub async fn translate(
    request: TranslationRequest,
    events: Sender<TranslationEvent>,
    cancellation: CancellationToken,
) -> anyhow::Result<()> {
    events
        .send(TranslationEvent::Started {
            id: request.id,
            source_text: request.text.clone(),
        })
        .await
        .context("UI event channel closed")?;

    let system_prompt =
        translation_system_prompt(&request.source_language, &request.target_language);
    let session_id = Uuid::new_v4().to_string();
    let provider = request.agents.active_provider()?;
    let agent = provider
        .rig_agent_builder(Some(&session_id))
        .context("failed to build the OpenAI-compatible client")?
        .preamble(&system_prompt)
        .build();
    let stream = agent
        .stream_prompt(translation_user_prompt(&request.text))
        .await;
    pin_mut!(stream);

    let mut first = true;
    loop {
        let timeout = if first {
            provider.first_chunk_timeout()
        } else {
            provider.stream_idle_timeout()
        };
        let next = tokio::select! {
            () = cancellation.cancelled() => return Ok(()),
            result = tokio::time::timeout(timeout, stream.next()) => {
                result.context("the LLM stream timed out")?
            }
        };
        match next {
            Some(Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(
                text,
            )))) => {
                first = false;
                events
                    .send(TranslationEvent::Delta {
                        id: request.id,
                        text: text.text,
                    })
                    .await
                    .context("UI event channel closed")?;
            }
            Some(Ok(MultiTurnStreamItem::FinalResponse(_))) | None => break,
            Some(Ok(_)) => {}
            Some(Err(error)) => return Err(error).context("LLM streaming failed"),
        }
    }
    events
        .send(TranslationEvent::Finished { id: request.id })
        .await
        .context("UI event channel closed")?;
    Ok(())
}
