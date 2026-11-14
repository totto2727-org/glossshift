//! Pre-engine Node configuration adapter. Only native hotkey interpretation lives here.

use std::{collections::HashSet, path::PathBuf, process::Command};

use anyhow::{Context as _, bail};
use global_hotkey::hotkey::HotKey;
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub struct AppConfig {
    pub shortcuts: Vec<ShortcutConfig>,
    pub window: WindowConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ShortcutConfig {
    pub keys: HotKey,
    pub target_language: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct WindowConfig {
    pub width: f32,
    pub height: f32,
    pub min_width: f32,
    pub min_height: f32,
}

#[derive(Deserialize)]
pub struct LoadedConfig {
    #[serde(flatten)]
    pub app: AppConfig,
    pub directory: PathBuf,
    pub created_files: bool,
}

fn decode_config(source: &[u8]) -> anyhow::Result<LoadedConfig> {
    let loaded: LoadedConfig = serde_json::from_slice(source)
        .map_err(|_| anyhow::anyhow!("The desktop configuration response is invalid"))?;
    let mut configured_hotkeys = HashSet::with_capacity(loaded.app.shortcuts.len());
    for shortcut in &loaded.app.shortcuts {
        if !configured_hotkeys.insert(shortcut.keys) {
            bail!("shortcut '{}' is configured more than once", shortcut.keys);
        }
    }
    Ok(loaded)
}

/// Resolve launch dimensions before NSH creates its engine or window.
///
/// # Errors
/// Returns a public diagnostic if the private Node command cannot load configuration.
pub fn load_or_initialize() -> anyhow::Result<LoadedConfig> {
    let runtime = crate::runtime::locate().map_err(anyhow::Error::msg)?;
    let mut command = Command::new(runtime.command);
    command
        .arg(runtime.entry)
        .arg("--desktop-config")
        .env_clear();
    for key in ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(
                key,
                value
                    .to_str()
                    .context("runtime paths must contain valid Unicode")?,
            );
        }
    }
    let output = command
        .output()
        .context("Unable to start desktop configuration runtime")?;
    if !output.status.success() {
        bail!("Unable to load GlossShift config.toml");
    }
    decode_config(&output.stdout)
}

#[cfg(test)]
#[path = "config_test.rs"]
mod tests;
