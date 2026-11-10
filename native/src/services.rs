//! Process-owned translation service. UI state belongs to TypeScript.

use std::sync::{
    Arc, Mutex, OnceLock,
    atomic::{AtomicU64, Ordering},
};

use async_channel::{Receiver, Sender};
use tokio_util::sync::CancellationToken;

use crate::{
    bridge_types::{Bootstrap, BridgeEvent, EventKind, Shortcut, WindowSettings},
    config, llm,
};

static SERVICES: OnceLock<Result<Arc<Services>, String>> = OnceLock::new();

pub struct Services {
    pub loaded: config::LoadedConfig,
    pub runtime: tokio::runtime::Runtime,
    pub events: Receiver<BridgeEvent>,
    pub sender: Sender<BridgeEvent>,
    controls: Receiver<BridgeEvent>,
    pub control_sender: Sender<BridgeEvent>,
    active: Mutex<Option<(String, CancellationToken)>>,
    next_id: AtomicU64,
    transport: crate::transport::Transport,
}

pub fn started_services() -> Option<&'static Arc<Services>> {
    SERVICES.get().and_then(|result| result.as_ref().ok())
}

pub fn services() -> Result<&'static Arc<Services>, String> {
    SERVICES
        .get_or_init(Services::new)
        .as_ref()
        .map_err(Clone::clone)
}

impl Services {
    fn new() -> Result<Arc<Self>, String> {
        let loaded = config::load_or_initialize()
            .map_err(|_| "Unable to load application or provider configuration.".to_owned())?;
        Self::with_loaded(loaded)
    }

    fn with_loaded(loaded: config::LoadedConfig) -> Result<Arc<Self>, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|_| "Unable to start the translation runtime.".to_owned())?;
        let (sender, events) = async_channel::bounded(256);
        let (control_sender, controls) = async_channel::bounded(8);
        Ok(Arc::new(Self {
            loaded,
            runtime,
            events,
            sender,
            controls,
            control_sender,
            active: Mutex::new(None),
            next_id: AtomicU64::new(1),
            transport: crate::transport::Transport::default(),
        }))
    }

    pub fn bootstrap(&self) -> Bootstrap {
        use crate::platform::AccessibilityPermission as _;
        self.bootstrap_for_host(Some(crate::selection::MacOsSelection.is_granted()))
    }

    pub fn terminal_bootstrap(&self) -> Bootstrap {
        self.bootstrap_for_host(None)
    }

    fn bootstrap_for_host(&self, accessibility: Option<bool>) -> Bootstrap {
        let window = &self.loaded.app.window;
        let accessibility_granted = accessibility.unwrap_or(false);
        Bootstrap {
            schema_version: 1,
            source_language: self.loaded.app.translation.source_language.clone(),
            shortcuts: self
                .loaded
                .app
                .shortcuts
                .iter()
                .map(|shortcut| Shortcut {
                    keys: shortcut.keys.to_string(),
                    target_language: shortcut.target_language.clone(),
                })
                .collect(),
            window: WindowSettings {
                width: window.width,
                height: window.height,
                min_width: window.min_width,
                min_height: window.min_height,
            },
            accessibility_granted,
            status: if self.loaded.created_files {
                "Created application configuration"
            } else if accessibility.is_none() || accessibility_granted {
                "Ready"
            } else {
                "Ready · Accessibility permission required"
            }
            .into(),
            provider_name: self.loaded.agents.active_provider_name().into(),
        }
    }

    pub fn next_id(&self) -> String {
        self.next_id.fetch_add(1, Ordering::Relaxed).to_string()
    }

    pub fn cancel(&self, id: Option<&str>) -> Result<(), String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "translation state unavailable")?;
        if active
            .as_ref()
            .is_some_and(|(current, _)| id.is_none_or(|id| current == id))
            && let Some((_, token)) = active.take()
        {
            token.cancel();
        }
        Ok(())
    }

    pub fn translate(
        self: &Arc<Self>,
        id: String,
        text: String,
        target: String,
    ) -> Result<(), String> {
        let number = self.next_id.fetch_add(1, Ordering::Relaxed);
        if id.trim().is_empty()
            || id.len() > 128
            || text.trim().is_empty()
            || text.len() > 4 * 1024 * 1024
            || target.trim().is_empty()
            || target.len() > 128
        {
            return Err("invalid translation request".into());
        }
        let provider = self
            .loaded
            .agents
            .active_provider()
            .map_err(|_| "Unable to resolve the selected provider configuration.".to_owned())?;
        if provider.api_key().trim().is_empty() || provider.api_key() == "replace-me" {
            return Err(
                "Configure the selected provider's named credential, then restart the app.".into(),
            );
        }
        let token = CancellationToken::new();
        {
            let mut active = self
                .active
                .lock()
                .map_err(|_| "translation state unavailable")?;
            if let Some((_, previous)) = active.replace((id.clone(), token.clone())) {
                previous.cancel();
            }
        }
        let request = llm::TranslationRequest {
            id: llm::RequestId(number),
            agents: self.loaded.agents.clone(),
            source_language: self.loaded.app.translation.source_language.clone(),
            target_language: target,
            text,
        };
        let service = self.clone();
        self.runtime.spawn(async move {
            crate::translation_bridge::run(service, request, token, id).await;
        });
        Ok(())
    }

    pub fn open_transport(&self) -> Result<String, String> {
        self.cancel(None)?;
        self.transport.open()
    }

    pub fn close_transport(&self, session: &str) -> Result<(), String> {
        self.transport.close(session)
    }

    pub async fn next_event(&self, session: &str) -> Result<BridgeEvent, String> {
        self.transport.receive(session, &self.events, false).await
    }

    pub async fn next_control(&self, session: &str) -> Result<BridgeEvent, String> {
        self.transport.receive(session, &self.controls, true).await
    }

    pub fn close(&self) {
        let _ = self.cancel(None);
        self.sender.close();
        self.control_sender.close();
    }

    pub fn terminal(&self, id: &str) {
        if let Ok(mut active) = self.active.lock()
            && active.as_ref().is_some_and(|(current, _)| current == id)
        {
            active.take();
        }
    }

    pub fn capture_event(id: String, text: String, target: String) -> BridgeEvent {
        let mut event = BridgeEvent::new(EventKind::Capture, id, text);
        event.target_language = target;
        event
    }
}

#[cfg(test)]
#[path = "services_test.rs"]
mod tests;
