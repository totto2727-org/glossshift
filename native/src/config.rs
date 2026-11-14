//! macOS window and shortcut settings. Translation configuration belongs to TypeScript.

use std::{
    collections::HashSet,
    fs,
    io::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use anyhow::{Context as _, bail};
use global_hotkey::hotkey::HotKey;
use serde::Deserialize;

pub const DEFAULT_CONFIG: &str = r#"[[shortcuts]]
keys = "Ctrl+Super+KeyJ"
target_language = "Japanese"

[window]
width = 560
height = 360
min_width = 320
min_height = 180
"#;

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

pub struct LoadedConfig {
    pub app: AppConfig,
    pub directory: PathBuf,
    pub created_files: bool,
}

/// Parse only OS settings, ignoring local translation and obsolete provider sections.
///
/// # Errors
/// Returns a public diagnostic for invalid settings.
pub fn parse_config(source: &str) -> anyhow::Result<AppConfig> {
    let config: AppConfig =
        toml::from_str(source).map_err(|_| anyhow::anyhow!("GlossShift config.toml is invalid"))?;
    let dimensions = [
        config.window.width,
        config.window.height,
        config.window.min_width,
        config.window.min_height,
    ];
    if dimensions
        .iter()
        .any(|value| !value.is_finite() || f64::from(*value) > f64::from(i32::MAX))
    {
        bail!("window size must contain finite values within native window limits");
    }
    if config.window.min_width <= 0.0
        || config.window.min_height <= 0.0
        || config.window.width < config.window.min_width
        || config.window.height < config.window.min_height
    {
        bail!("window size must be positive and at least its minimum size");
    }
    if config.shortcuts.is_empty() {
        bail!("at least one shortcut is required");
    }
    let mut configured_hotkeys = HashSet::with_capacity(config.shortcuts.len());
    for shortcut in &config.shortcuts {
        if shortcut.target_language.trim().is_empty() {
            bail!("every shortcut requires a non-empty target_language");
        }
        if !configured_hotkeys.insert(shortcut.keys) {
            bail!("shortcut '{}' is configured more than once", shortcut.keys);
        }
    }
    Ok(config)
}

/// Load macOS settings without accessing shared model credentials.
///
/// # Errors
/// Returns an error when the application settings cannot be created or read.
pub fn load_or_initialize() -> anyhow::Result<LoadedConfig> {
    let directory = xdg::BaseDirectories::with_prefix("glossshift")
        .get_config_home()
        .context("HOME and XDG_CONFIG_HOME are unavailable")?;
    let config_path = directory.join("config.toml");
    let created_files = create_if_missing(&config_path, DEFAULT_CONFIG, 0o644)?;
    let app = parse_config(
        &fs::read_to_string(&config_path).context("failed to read GlossShift config.toml")?,
    )?;
    Ok(LoadedConfig {
        app,
        directory,
        created_files,
    })
}

fn create_if_missing(path: &Path, content: &str, mode: u32) -> anyhow::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).context("failed to inspect configuration path"),
    }
    let parent = path.parent().context("configuration path has no parent")?;
    fs::create_dir_all(parent).context("failed to create configuration directory")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(content.as_bytes())?;
    temporary
        .as_file()
        .set_permissions(fs::Permissions::from_mode(mode))?;
    match temporary.persist_noclobber(path) {
        Ok(_) => Ok(true),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error.error).context("failed to publish application configuration"),
    }
}

#[cfg(test)]
#[path = "config_test.rs"]
mod tests;
