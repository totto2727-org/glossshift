use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions, Permissions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use anyhow::{Context as _, bail};
use global_hotkey::hotkey::HotKey;
use serde::Deserialize;

pub const DEFAULT_CONFIG: &str = r#"active_provider = "default"

[providers.default]
base_url = "https://api.openai.com/v1"
model = "gpt-4.1-mini"
credential = "default"
first_chunk_timeout_seconds = 30
stream_idle_timeout_seconds = 60

[translation]
source_language = "auto"

[[shortcuts]]
keys = "Ctrl+Super+KeyJ"
target_language = "Japanese"

[window]
width = 560
height = 360
min_width = 320
min_height = 180
"#;

const DEFAULT_CREDENTIALS: &str = r#"[credentials.default]
api_key = "replace-me"
"#;

#[derive(Clone, Debug, Deserialize)]
pub struct AppConfig {
    pub active_provider: String,
    pub providers: HashMap<String, ProviderConfig>,
    pub translation: TranslationConfig,
    pub shortcuts: Vec<ShortcutConfig>,
    pub window: WindowConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
    pub credential: String,
    #[serde(default)]
    pub request_parameters: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(default = "default_first_chunk_timeout")]
    pub first_chunk_timeout_seconds: u64,
    #[serde(default = "default_stream_idle_timeout")]
    pub stream_idle_timeout_seconds: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct TranslationConfig {
    pub source_language: String,
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
struct CredentialsFile {
    credentials: HashMap<String, Credential>,
}

#[derive(Deserialize)]
struct Credential {
    api_key: String,
}

pub struct LoadedConfig {
    pub app: AppConfig,
    pub api_key: String,
    pub directory: PathBuf,
    pub created_files: bool,
}

impl AppConfig {
    /// Return the provider selected by `active_provider`.
    ///
    /// # Errors
    /// Returns an error when the selected provider is not configured.
    pub fn provider(&self) -> anyhow::Result<&ProviderConfig> {
        self.providers
            .get(&self.active_provider)
            .with_context(|| format!("provider '{}' is not configured", self.active_provider))
    }
}

/// Parse and validate application configuration TOML.
///
/// # Errors
/// Returns an error when the TOML or any required application invariant is invalid.
pub fn parse_config(source: &str) -> anyhow::Result<AppConfig> {
    let config: AppConfig = toml::from_str(source).context("config.toml is invalid")?;
    let provider = config.provider()?;
    if provider.base_url.trim().is_empty() || provider.model.trim().is_empty() {
        bail!("the active provider requires non-empty base_url and model");
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

/// Load the shared XDG configuration and create templates when missing.
///
/// # Errors
/// Returns an error when configuration files cannot be created, read, parsed, or validated.
pub fn load_or_initialize() -> anyhow::Result<LoadedConfig> {
    let directories = xdg::BaseDirectories::with_prefix("glossshift");
    let directory = directories
        .get_config_home()
        .context("HOME and XDG_CONFIG_HOME are unavailable")?;
    let config_path = directories
        .place_config_file("config.toml")
        .context("failed to prepare the config.toml path")?;
    let credentials_path = directories
        .place_config_file("credentials.toml")
        .context("failed to prepare the credentials.toml path")?;
    let created_config = create_if_missing(&config_path, DEFAULT_CONFIG, 0o644)?;
    let created_credentials = create_if_missing(&credentials_path, DEFAULT_CREDENTIALS, 0o600)?;
    fs::set_permissions(&credentials_path, Permissions::from_mode(0o600))
        .context("failed to set credentials.toml permissions to 0600")?;

    let app =
        parse_config(&fs::read_to_string(&config_path).context("failed to read config.toml")?)?;
    let credentials: CredentialsFile = toml::from_str(
        &fs::read_to_string(&credentials_path).context("failed to read credentials.toml")?,
    )
    .context("credentials.toml is invalid")?;
    let provider = app.provider()?;
    let api_key = credentials
        .credentials
        .get(&provider.credential)
        .with_context(|| format!("credential '{}' is not configured", provider.credential))?
        .api_key
        .clone();

    Ok(LoadedConfig {
        app,
        api_key,
        directory,
        created_files: created_config || created_credentials,
    })
}

fn create_if_missing(path: &Path, content: &str, mode: u32) -> anyhow::Result<bool> {
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(path)
    {
        Ok(mut file) => {
            file.write_all(content.as_bytes())
                .with_context(|| format!("failed to write {}", path.display()))?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => Err(error).with_context(|| format!("failed to create {}", path.display())),
    }
}

const fn default_first_chunk_timeout() -> u64 {
    30
}

const fn default_stream_idle_timeout() -> u64 {
    60
}

#[cfg(test)]
mod tests {
    use super::*;
    use global_hotkey::hotkey::{Code, Modifiers};

    #[test]
    fn parses_default_config() {
        let config = parse_config(DEFAULT_CONFIG).unwrap_or_else(|error| panic!("{error}"));
        let provider = config.provider().unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(provider.model, "gpt-4.1-mini");
        assert_eq!(provider.first_chunk_timeout_seconds, 30);
        assert_eq!(provider.stream_idle_timeout_seconds, 60);
        assert_eq!(config.shortcuts.len(), 1);
        assert_eq!(config.shortcuts[0].target_language, "Japanese");
        assert_eq!(
            config.shortcuts[0].keys.mods,
            Modifiers::CONTROL | Modifiers::SUPER
        );
        assert_eq!(config.shortcuts[0].keys.key, Code::KeyJ);
        assert!((config.window.width - 560.0).abs() < f32::EPSILON);
    }

    #[test]
    fn rejects_window_smaller_than_minimum() {
        let source = DEFAULT_CONFIG.replace("width = 560", "width = 100");
        assert!(parse_config(&source).is_err());
    }

    #[test]
    fn parses_target_language_for_each_shortcut() {
        // Given
        let source = format!(
            "{DEFAULT_CONFIG}\n[[shortcuts]]\nkeys = \"Ctrl+Super+KeyE\"\ntarget_language = \"English\"\n"
        );

        // When
        let config = parse_config(&source).unwrap_or_else(|error| panic!("{error}"));

        // Then
        assert_eq!(config.shortcuts.len(), 2);
        assert_eq!(config.shortcuts[0].target_language, "Japanese");
        assert_eq!(config.shortcuts[1].target_language, "English");
    }

    #[test]
    fn parses_provider_request_parameters() {
        // Given
        let source = format!(
            "{DEFAULT_CONFIG}\n[providers.default.request_parameters]\nreasoning_effort = \"none\"\n"
        );

        // When
        let config = parse_config(&source).unwrap_or_else(|error| panic!("{error}"));
        let provider = config.provider().unwrap_or_else(|error| panic!("{error}"));

        // Then
        assert_eq!(
            provider
                .request_parameters
                .as_ref()
                .and_then(|parameters| parameters.get("reasoning_effort"))
                .and_then(serde_json::Value::as_str),
            Some("none")
        );
    }

    #[test]
    fn rejects_duplicate_shortcut_keys() {
        // Given
        let source = format!(
            "{DEFAULT_CONFIG}\n[[shortcuts]]\nkeys = \"Ctrl+Super+KeyJ\"\ntarget_language = \"English\"\n"
        );

        // When
        let result = parse_config(&source);

        // Then
        assert!(result.is_err());
    }

    #[test]
    fn rejects_empty_target_language() {
        // Given
        let source =
            DEFAULT_CONFIG.replace("target_language = \"Japanese\"", "target_language = \"\"");

        // When
        let result = parse_config(&source);

        // Then
        assert!(result.is_err());
    }
}
