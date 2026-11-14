//! OS service lifetime and generation-scoped control events. Translation runs in TypeScript.

use std::sync::{
    Arc, OnceLock,
    atomic::{AtomicU64, Ordering},
};

use async_channel::{Receiver, Sender};

use crate::{
    bridge_types::{Bootstrap, BridgeEvent, EventKind, Shortcut, WindowSettings},
    config,
};

static SERVICES: OnceLock<Result<Arc<Services>, String>> = OnceLock::new();

pub struct Services {
    pub loaded: config::LoadedConfig,
    pub runtime: tokio::runtime::Runtime,
    controls: Receiver<BridgeEvent>,
    pub control_sender: Sender<BridgeEvent>,
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
            .map_err(|_| "Unable to load native application settings.".to_owned())?;
        Self::with_loaded(loaded)
    }

    fn with_loaded(loaded: config::LoadedConfig) -> Result<Arc<Self>, String> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|_| "Unable to start native services.".to_owned())?;
        let (control_sender, controls) = async_channel::bounded(8);
        Ok(Arc::new(Self {
            loaded,
            runtime,
            controls,
            control_sender,
            next_id: AtomicU64::new(1),
            transport: crate::transport::Transport::default(),
        }))
    }

    pub fn bootstrap(&self) -> Result<Bootstrap, String> {
        use crate::platform::AccessibilityPermission as _;
        self.bootstrap_for_host(Some(crate::selection::MacOsSelection.is_granted()))
    }

    pub fn terminal_bootstrap(&self) -> Result<Bootstrap, String> {
        self.bootstrap_for_host(None)
    }

    fn bootstrap_for_host(&self, accessibility: Option<bool>) -> Result<Bootstrap, String> {
        let window = &self.loaded.app.window;
        let accessibility_granted = accessibility.unwrap_or(false);
        Ok(Bootstrap {
            schema_version: 2,
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
            runtime: crate::runtime::locate()?,
        })
    }

    pub fn next_id(&self) -> String {
        self.next_id.fetch_add(1, Ordering::Relaxed).to_string()
    }

    pub fn open_transport(&self) -> Result<String, String> {
        self.transport.open()
    }

    pub fn close_transport(&self, session: &str) -> Result<(), String> {
        self.transport.close(session)
    }

    pub async fn next_control(&self, session: &str) -> Result<BridgeEvent, String> {
        self.transport.receive(session, &self.controls).await
    }

    pub fn close(&self) {
        self.control_sender.close();
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
