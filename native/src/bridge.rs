//! NSH module exports. Native objects never cross the JavaScript boundary.

use nsh_core::prelude::*;

use crate::{
    bridge_types::{Bootstrap, BridgeEvent},
    services::services,
};

/// Typed application bridge exported as `glossshift/native`.
#[module]
pub struct Bridge;

#[module]
impl Bridge {
    /// Start native services and return credential-free settings.
    ///
    /// # Errors
    /// Returns configuration, shortcut registration, or native service errors.
    pub async fn initialize() -> Result<Bootstrap, String> {
        crate::desktop::initialize().await?;
        services()?.bootstrap()
    }

    /// Receive one capture or control event independently of translation work.
    ///
    /// # Errors
    /// Returns an error if the transport closes or already has a waiting consumer.
    pub async fn next_control(session_id: String) -> Result<BridgeEvent, String> {
        services()?.next_control(&session_id).await
    }

    /// Open a receive generation, releasing any previous UI's pending receives.
    ///
    /// # Errors
    /// Returns service or transport state errors.
    pub fn open_transport(_cx: &mut ModuleCx) -> Result<String, String> {
        services()?.open_transport()
    }

    /// Release pending receives only for this UI's generation.
    ///
    /// # Errors
    /// Returns transport state errors.
    pub fn close_transport(session_id: String, _cx: &mut ModuleCx) -> Result<(), String> {
        let result = services()?.close_transport(&session_id);
        drop(session_id);
        result
    }

    /// Capture the foreground application's selection before revealing the popup.
    ///
    /// # Errors
    /// Returns permission, selection, or main-thread transport errors.
    pub async fn selection() -> Result<String, String> {
        crate::desktop::capture().await
    }
}
