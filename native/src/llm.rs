use std::sync::Arc;

use anyhow::Context as _;
use async_channel::Sender;
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

/// Stream one translation request into the supplied event channel.
///
/// # Errors
/// Returns an error when the provider cannot be streamed or reported to the receiver.
pub async fn translate(
    request: TranslationRequest,
    events: Sender<TranslationEvent>,
    cancellation: CancellationToken,
) -> anyhow::Result<()> {
    if !send_event(
        &events,
        TranslationEvent::Started {
            id: request.id,
            source_text: request.text.clone(),
        },
        &cancellation,
    )
    .await?
    {
        return Ok(());
    }

    let system_prompt =
        translation_system_prompt(&request.source_language, &request.target_language);
    let session_id = Uuid::new_v4().to_string();
    let provider = request.agents.active_provider()?;
    let agent = provider
        .rig_agent_builder(Some(&session_id))
        .context("failed to build the OpenAI-compatible client")?
        .preamble(&system_prompt)
        .build();
    let mut deadline = tokio::time::Instant::now() + provider.first_chunk_timeout();
    let user_prompt = translation_user_prompt(&request.text);
    let stream = tokio::select! {
        biased;
        () = cancellation.cancelled() => return Ok(()),
        result = tokio::time::timeout_at(
            deadline,
            agent.stream_prompt(user_prompt),
        ) => result.context("the LLM connection timed out")?,
    };
    pin_mut!(stream);

    loop {
        let next = tokio::select! {
            biased;
            () = cancellation.cancelled() => return Ok(()),
            result = tokio::time::timeout_at(deadline, stream.next()) => {
                result.context("the LLM stream timed out")?
            }
        };
        match next {
            Some(Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(
                text,
            )))) => {
                if !send_event(
                    &events,
                    TranslationEvent::Delta {
                        id: request.id,
                        text: text.text,
                    },
                    &cancellation,
                )
                .await?
                {
                    return Ok(());
                }
                deadline = tokio::time::Instant::now() + provider.stream_idle_timeout();
            }
            Some(Ok(MultiTurnStreamItem::FinalResponse(_))) | None => break,
            Some(Ok(_)) => {}
            Some(Err(error)) => return Err(error).context("LLM streaming failed"),
        }
    }
    send_event(
        &events,
        TranslationEvent::Finished { id: request.id },
        &cancellation,
    )
    .await?;
    Ok(())
}

async fn send_event(
    events: &Sender<TranslationEvent>,
    event: TranslationEvent,
    cancellation: &CancellationToken,
) -> anyhow::Result<bool> {
    tokio::select! {
        biased;
        () = cancellation.cancelled() => Ok(false),
        result = events.send(event) => {
            result.context("UI event channel closed")?;
            Ok(true)
        }
    }
}
