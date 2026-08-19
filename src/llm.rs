use std::time::Duration;

use anyhow::Context as _;
use async_channel::{Receiver, Sender};
use futures::{StreamExt as _, pin_mut};
use rig::{
    agent::MultiTurnStreamItem,
    prelude::*,
    providers::openai,
    streaming::{StreamedAssistantContent, StreamingPrompt},
};
use tokio_util::sync::CancellationToken;

use crate::{
    config::ProviderConfig,
    prompt::{translation_system_prompt, translation_user_prompt},
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RequestId(pub u64);

pub struct TranslationRequest {
    pub id: RequestId,
    pub provider: ProviderConfig,
    pub api_key: String,
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
/// Returns an error when the provider cannot be configured, streamed, or reported to the receiver.
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

    let client = openai::CompletionsClient::builder()
        .api_key(&request.api_key)
        .base_url(&request.provider.base_url)
        .build()
        .context("failed to build the OpenAI-compatible client")?;
    let system_prompt =
        translation_system_prompt(&request.source_language, &request.target_language);
    let agent_builder = client
        .agent(&request.provider.model)
        .preamble(&system_prompt);
    let agent = match request.provider.request_parameters.clone() {
        Some(parameters) => agent_builder
            .additional_params(serde_json::Value::Object(parameters))
            .build(),
        None => agent_builder.build(),
    };
    let prompt = translation_user_prompt(&request.text);
    let stream = agent.stream_prompt(prompt).await;
    pin_mut!(stream);

    let mut first = true;
    loop {
        let timeout = if first {
            request.provider.first_chunk_timeout_seconds
        } else {
            request.provider.stream_idle_timeout_seconds
        };
        let next = tokio::select! {
            () = cancellation.cancelled() => return Ok(()),
            result = tokio::time::timeout(Duration::from_secs(timeout), stream.next()) => {
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
