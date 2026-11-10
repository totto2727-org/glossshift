pub mod cli;
pub mod config;
pub mod llm;
pub mod prompt;

mod autostart;
mod bridge;
mod bridge_types;
mod desktop;
mod dispatch;
mod platform;
mod selection;
mod services;
mod shortcuts;
mod startup;
mod translation_bridge;
mod transport;
mod tray;

pub use bridge::Bridge;
use nsh_core::prelude::*;

/// Registers types and lifecycle function pointers without accessing configuration.
#[native_module("glossshift/native")]
fn native(registry: &mut Registry) {
    nsh_platform_macos::set_standalone_hooks(nsh_platform_macos::StandaloneHooks {
        setup: desktop::setup,
        shutdown: desktop::shutdown,
    });
    registry.module::<Bridge>();
}

#[cfg(test)]
mod bridge_test;

#[cfg(test)]
mod cli_test;
