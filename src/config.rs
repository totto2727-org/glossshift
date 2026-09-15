use std::{
    collections::HashSet,
    fs,
    io::Write,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::Arc,
};

use agents_config::{AgentConfigPaths, LoadedAgentsConfig, ResolvedProvider};
use anyhow::{Context as _, bail};
use global_hotkey::hotkey::HotKey;
use serde::Deserialize;

pub const DEFAULT_CONFIG: &str = r#"[translation]
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

#[derive(Clone, Debug, Deserialize)]
pub struct AppConfig {
    pub translation: TranslationConfig,
    pub shortcuts: Vec<ShortcutConfig>,
    pub window: WindowConfig,
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

pub struct LoadedConfig {
    pub app: AppConfig,
    pub agents: Arc<LoadedAgentsConfig>,
    pub directory: PathBuf,
    pub created_files: bool,
}

impl LoadedConfig {
    /// Return the shared provider selected for `GlossShift` translations.
    ///
    /// # Errors
    /// Returns an error when the configured provider cannot be resolved.
    pub fn provider(&self) -> anyhow::Result<&ResolvedProvider> {
        Ok(self.agents.active_provider()?)
    }
}

/// Parse and validate GlossShift-specific configuration TOML.
///
/// Provider definitions and credentials belong to `agents-config` and are ignored
/// here to make a legacy configuration readable during migration.
///
/// # Errors
/// Returns an error when the TOML or any required application invariant is invalid.
pub fn parse_config(source: &str) -> anyhow::Result<AppConfig> {
    let config: AppConfig =
        toml::from_str(source).map_err(|_| anyhow::anyhow!("GlossShift config.toml is invalid"))?;
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

/// Load `GlossShift` settings and the selected shared agent provider.
///
/// Existing `GlossShift` provider settings migrate into the shared configuration only
/// when that file does not already exist. Legacy files and existing shared
/// credentials are never changed.
///
/// # Errors
/// Returns an error when configuration files cannot be created, migrated, read,
/// parsed, or validated.
pub fn load_or_initialize() -> anyhow::Result<LoadedConfig> {
    let directory = legacy_directory()?;
    let config_path = directory.join("config.toml");
    let agents_paths = AgentConfigPaths::standard()?;
    migrate_legacy_provider_config(
        &config_path,
        &directory.join("credentials.toml"),
        &agents_paths,
    )?;

    let created_app = create_if_missing(&config_path, DEFAULT_CONFIG, 0o644)?;
    let app = parse_config(
        &fs::read_to_string(&config_path).context("failed to read GlossShift config.toml")?,
    )?;
    let agents = agents_config::load_or_initialize(agents_paths)?;
    let created_agents = agents.created_files();
    Ok(LoadedConfig {
        app,
        agents: Arc::new(agents),
        directory,
        created_files: created_app || created_agents,
    })
}

fn legacy_directory() -> anyhow::Result<PathBuf> {
    xdg::BaseDirectories::with_prefix("glossshift")
        .get_config_home()
        .context("HOME and XDG_CONFIG_HOME are unavailable")
}

fn migrate_legacy_provider_config(
    legacy_config_path: &Path,
    legacy_credentials_path: &Path,
    agents_paths: &AgentConfigPaths,
) -> anyhow::Result<()> {
    if agents_paths.config_path().exists() || !legacy_config_path.exists() {
        return Ok(());
    }

    let source = fs::read_to_string(legacy_config_path)
        .context("failed to read legacy GlossShift configuration")?;
    let mut document: toml::Table = toml::from_str(&source).map_err(|_| {
        anyhow::anyhow!("legacy GlossShift config.toml is invalid and cannot be migrated")
    })?;
    let providers = document.remove("providers");
    let active_provider = document.remove("active_provider");
    if providers.is_none() && active_provider.is_none() {
        return Ok(());
    }
    let Some(providers) = providers else {
        bail!("legacy GlossShift configuration has active_provider but no providers section");
    };
    let Some(active_provider) = active_provider else {
        bail!("legacy GlossShift configuration has providers but no active_provider");
    };

    let mut shared = toml::Table::new();
    shared.insert("active_provider".into(), active_provider);
    shared.insert("providers".into(), providers);
    let shared_config = toml::to_string_pretty(&shared)
        .context("failed to serialize migrated shared agent configuration")?;
    validate_legacy_migration(&shared_config, legacy_credentials_path, agents_paths)?;

    let credentials = if agents_paths.credentials_path().exists() {
        None
    } else {
        Some(
            fs::read(legacy_credentials_path)
                .context("failed to read legacy GlossShift credentials")?,
        )
    };
    if let Some(credentials) = credentials
        && !create_bytes_if_missing(agents_paths.credentials_path(), &credentials, 0o600)?
    {
        bail!("shared credentials appeared during legacy migration; retry startup");
    }
    if !create_if_missing(agents_paths.config_path(), &shared_config, 0o600)? {
        return Ok(());
    }
    Ok(())
}

fn validate_legacy_migration(
    shared_config: &str,
    legacy_credentials_path: &Path,
    agents_paths: &AgentConfigPaths,
) -> anyhow::Result<()> {
    let parent = agents_paths
        .config_path()
        .parent()
        .context("shared agent configuration path has no parent directory")?;
    fs::create_dir_all(parent).with_context(|| {
        format!(
            "failed to create shared configuration directory {}",
            parent.display()
        )
    })?;
    let temporary = tempfile::NamedTempFile::new_in(parent)
        .context("failed to create temporary shared configuration")?;
    fs::write(temporary.path(), shared_config)
        .context("failed to write temporary shared configuration")?;
    let credentials_path = if agents_paths.credentials_path().exists() {
        agents_paths.credentials_path().to_path_buf()
    } else {
        legacy_credentials_path.to_path_buf()
    };
    let validation_paths = AgentConfigPaths::new(temporary.path().to_path_buf(), credentials_path)
        .context("failed to prepare temporary shared configuration paths")?;
    agents_config::load_from_paths(validation_paths)
        .context("legacy GlossShift provider settings cannot be migrated")?;
    Ok(())
}

fn create_if_missing(path: &Path, content: &str, mode: u32) -> anyhow::Result<bool> {
    create_bytes_if_missing(path, content.as_bytes(), mode)
}

fn create_bytes_if_missing(path: &Path, content: &[u8], mode: u32) -> anyhow::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| {
                format!("failed to inspect configuration path {}", path.display())
            });
        }
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create configuration directory {}",
                parent.display()
            )
        })?;
    }
    let parent = path
        .parent()
        .context("configuration path has no parent directory")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent).with_context(|| {
        format!(
            "failed to create temporary configuration for {}",
            path.display()
        )
    })?;
    temporary.write_all(content).with_context(|| {
        format!(
            "failed to write temporary configuration for {}",
            path.display()
        )
    })?;
    temporary
        .as_file()
        .set_permissions(fs::Permissions::from_mode(mode))
        .with_context(|| format!("failed to set permissions for {}", path.display()))?;
    match temporary.persist_noclobber(path) {
        Ok(_) => Ok(true),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(error) => {
            Err(error.error).with_context(|| format!("failed to create {}", path.display()))
        }
    }
}

#[cfg(test)]
#[path = "config_test.rs"]
mod tests;
