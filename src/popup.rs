//! Popup state and translation requests, independent of a windowing framework.

use std::{rc::Rc, sync::Arc};

use async_channel::Sender;
use glossshift::{
    config::AppConfig,
    llm::{RequestId, TranslationEvent, TranslationRequest},
};
use llm_profiles::LoadedAgentsConfig;

use crate::platform::SelectionSource;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase {
    Ready,
    Streaming,
    Complete,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Pane {
    Source,
    Translation,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PopupState {
    pub source_text: String,
    pub output: String,
    pub status: String,
    pub phase: Phase,
}

pub struct PopupController {
    config: Arc<AppConfig>,
    agents: Arc<LoadedAgentsConfig>,
    requests: Sender<TranslationRequest>,
    selection: Rc<dyn SelectionSource>,
    next_request_id: u64,
    active_request: Option<RequestId>,
    state: PopupState,
}

impl PopupController {
    pub fn new(
        config: Arc<AppConfig>,
        agents: Arc<LoadedAgentsConfig>,
        requests: Sender<TranslationRequest>,
        initial_status: String,
        selection: Rc<dyn SelectionSource>,
    ) -> Self {
        Self {
            config,
            agents,
            requests,
            selection,
            next_request_id: 1,
            active_request: None,
            state: PopupState {
                source_text: "No text captured yet.".into(),
                output: "Select text in any application, then press a configured shortcut.".into(),
                status: initial_status,
                phase: Phase::Ready,
            },
        }
    }

    pub fn snapshot(&self) -> PopupState {
        self.state.clone()
    }

    pub fn trigger_translation(&mut self, target_language: &str) {
        let text = match self.selection.selected_text() {
            Ok(text) => text,
            Err(error) => {
                self.fail(format!("{error:#}"));
                return;
            }
        };
        let provider = match self.agents.active_provider() {
            Ok(provider) => provider,
            Err(error) => {
                self.fail(error.to_string());
                return;
            }
        };
        if provider.api_key().trim().is_empty() || provider.api_key() == "replace-me" {
            self.fail(format!(
                "Set api_key in {}, then restart the app.",
                self.agents.paths().credentials_path().display()
            ));
            return;
        }
        let id = RequestId(self.next_request_id);
        self.next_request_id = self.next_request_id.saturating_add(1);
        let request = TranslationRequest {
            id,
            agents: self.agents.clone(),
            source_language: self.config.translation.source_language.clone(),
            target_language: target_language.to_owned(),
            text: text.clone(),
        };
        if self.requests.try_send(request).is_err() {
            self.fail("The translation queue is busy. Try the shortcut again.".into());
            return;
        }
        self.active_request = Some(id);
        self.state.source_text = text;
        self.state.output.clear();
        self.state.status = format!("Translating to {target_language}");
        self.state.phase = Phase::Streaming;
    }

    /// Returns whether the event changed the current popup state.
    pub fn handle_event(&mut self, event: TranslationEvent) -> bool {
        if self.active_request != Some(event.request_id()) {
            return false;
        }
        match event {
            TranslationEvent::Started { source_text, .. } => {
                self.state.source_text = source_text;
                self.state.output.clear();
                self.state.phase = Phase::Streaming;
            }
            TranslationEvent::Delta { text, .. } => self.state.output.push_str(&text),
            TranslationEvent::Finished { .. } => {
                self.active_request = None;
                self.state.status = "Translation complete".into();
                self.state.phase = Phase::Complete;
            }
            TranslationEvent::Failed { message, .. } => self.fail(message),
        }
        true
    }

    pub fn text(&self, pane: Pane) -> &str {
        match pane {
            Pane::Source => &self.state.source_text,
            Pane::Translation => &self.state.output,
        }
    }

    pub fn copied(&mut self) {
        self.state.status = "Text copied".into();
    }

    fn fail(&mut self, message: String) {
        self.active_request = None;
        self.state.output = message;
        self.state.status = "Action required".into();
        self.state.phase = Phase::Error;
    }
}
