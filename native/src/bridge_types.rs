//! Typed values crossing the NSH native-module boundary. Never include credentials.

use nsh_core::prelude::*;

#[derive(Clone, JsObject)]
pub struct Shortcut {
    pub keys: String,
    pub target_language: String,
}

#[derive(Clone, JsObject)]
pub struct WindowSettings {
    pub width: f32,
    pub height: f32,
    pub min_width: f32,
    pub min_height: f32,
}

#[derive(Clone, JsObject)]
pub struct Bootstrap {
    pub schema_version: u32,
    pub source_language: String,
    pub shortcuts: Vec<Shortcut>,
    pub window: WindowSettings,
    pub accessibility_granted: bool,
    pub status: String,
    pub provider_name: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum EventKind {
    Capture,
    Started,
    Delta,
    Finished,
    Failed,
    Cancelled,
    Reopened,
}

#[derive(Clone, Debug, JsObject)]
pub struct BridgeEvent {
    pub kind: EventKind,
    pub request_id: String,
    pub seq: u32,
    pub text: String,
    pub target_language: String,
}

impl BridgeEvent {
    pub fn new(kind: EventKind, request_id: impl Into<String>, text: impl Into<String>) -> Self {
        Self {
            kind,
            request_id: request_id.into(),
            seq: 0,
            text: text.into(),
            target_language: String::new(),
        }
    }
}
