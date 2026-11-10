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
        Ok(services()?.bootstrap())
    }

    /// Load shared settings for the terminal without starting desktop services.
    ///
    /// # Errors
    /// Returns application or provider configuration errors.
    pub fn initialize_terminal(_cx: &mut ModuleCx) -> Result<Bootstrap, String> {
        Ok(services()?.terminal_bootstrap())
    }

    /// Receive one ordered event. Only one consumer can wait at a time.
    ///
    /// # Errors
    /// Returns an error if the transport closes or already has a waiting consumer.
    pub async fn next_event(session_id: String) -> Result<BridgeEvent, String> {
        services()?.next_event(&session_id).await
    }

    /// Receive one capture or control event independently of provider backlog.
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

    /// Replace the active translation with a request identified by the UI.
    ///
    /// # Errors
    /// Returns invalid-input, provider configuration, or service state errors.
    pub fn translate(
        request_id: String,
        source: String,
        target: String,
        _cx: &mut ModuleCx,
    ) -> Result<(), String> {
        services()?.translate(request_id, source, target)
    }

    /// Cancel a matching request without cancelling a newer translation.
    ///
    /// # Errors
    /// Returns an error if translation state is unavailable.
    pub fn cancel(request_id: String, _cx: &mut ModuleCx) -> Result<(), String> {
        let result = services()?.cancel(Some(&request_id));
        drop(request_id);
        result
    }

    /// Capture the foreground application's selection before revealing the popup.
    ///
    /// # Errors
    /// Returns permission, selection, or main-thread transport errors.
    pub async fn selection() -> Result<String, String> {
        crate::desktop::capture().await
    }

    /// Copy plain text without exposing native clipboard objects.
    ///
    /// # Errors
    /// Returns clipboard or main-thread transport errors.
    pub async fn copy(text: String) -> Result<(), String> {
        crate::desktop::copy(text).await
    }

    /// Hide the retained window without stopping its engine.
    ///
    /// # Errors
    /// Returns native transport errors.
    pub async fn hide() -> Result<(), String> {
        crate::desktop::hide().await
    }

    /// Reveal and focus the retained translation window.
    ///
    /// # Errors
    /// Returns native transport errors.
    pub async fn reveal() -> Result<(), String> {
        crate::desktop::reveal().await
    }

    /// Cancel the active stream and ask NSH to stop the application.
    ///
    /// # Errors
    /// Returns native transport errors.
    pub async fn quit() -> Result<(), String> {
        crate::desktop::quit().await
    }
}
