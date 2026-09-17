use super::*;
use global_hotkey::hotkey::{Code, Modifiers};
use std::fs;
use tempfile::TempDir;

#[test]
fn parses_default_config_without_provider_definitions() {
    let config = parse_config(DEFAULT_CONFIG).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(config.translation.source_language, "auto");
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
fn accepts_legacy_provider_sections_while_parsing_app_settings() {
    let source = format!(
        "active_provider = \"default\"\n\n[providers.default]\nbase_url = \"https://example.test/v1\"\nmodel = \"model\"\ncredential = \"default\"\n\n{DEFAULT_CONFIG}"
    );
    let config = parse_config(&source).unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(config.shortcuts[0].target_language, "Japanese");
}

#[test]
fn rejects_window_smaller_than_minimum() {
    let source = DEFAULT_CONFIG.replace("width = 560", "width = 100");
    assert!(parse_config(&source).is_err());
}

#[test]
fn rejects_duplicate_shortcut_keys() {
    let source = format!(
        "{DEFAULT_CONFIG}\n[[shortcuts]]\nkeys = \"Ctrl+Super+KeyJ\"\ntarget_language = \"English\"\n"
    );
    assert!(parse_config(&source).is_err());
}

#[test]
fn rejects_empty_target_language() {
    let source = DEFAULT_CONFIG.replace("target_language = \"Japanese\"", "target_language = \"\"");
    assert!(parse_config(&source).is_err());
}

#[test]
fn migrates_legacy_settings_without_changing_legacy_files() -> anyhow::Result<()> {
    let fixture = TempDir::new()?;
    let legacy_directory = fixture.path().join("glossshift");
    let agents_directory = fixture.path().join("agents");
    fs::create_dir_all(&legacy_directory)?;
    let legacy_config = format!(
        "# keep this legacy file unchanged\nactive_provider = \"default\"\n\n[providers.default]\nbase_url = \"https://example.test/v1\"\nmodel = \"test-model\"\ncredential = \"default\"\n\n{DEFAULT_CONFIG}"
    );
    let legacy_credentials = "[credentials.default]\napi_key = \"test-key\"\n";
    let legacy_config_path = legacy_directory.join("config.toml");
    let legacy_credentials_path = legacy_directory.join("credentials.toml");
    fs::write(&legacy_config_path, &legacy_config)?;
    fs::write(&legacy_credentials_path, legacy_credentials)?;
    let paths = AgentConfigPaths::new(
        agents_directory.join("config.toml"),
        agents_directory.join("credentials.toml"),
    )?;

    migrate_legacy_provider_config(&legacy_config_path, &legacy_credentials_path, &paths)?;

    assert_eq!(fs::read_to_string(&legacy_config_path)?, legacy_config);
    assert_eq!(
        fs::read_to_string(&legacy_credentials_path)?,
        legacy_credentials
    );
    assert!(llm_profiles::load_from_paths(paths).is_ok());
    Ok(())
}

#[test]
fn never_replaces_existing_shared_configuration() -> anyhow::Result<()> {
    let fixture = TempDir::new()?;
    let legacy_directory = fixture.path().join("glossshift");
    let agents_directory = fixture.path().join("agents");
    fs::create_dir_all(&legacy_directory)?;
    fs::create_dir_all(&agents_directory)?;
    let legacy_config_path = legacy_directory.join("config.toml");
    let legacy_credentials_path = legacy_directory.join("credentials.toml");
    fs::write(
        &legacy_config_path,
        "active_provider = \"legacy\"\n[providers.legacy]\n",
    )?;
    fs::write(&legacy_credentials_path, "legacy credential")?;
    let shared_config = "shared configuration must survive";
    let shared_credentials = "shared credentials must survive";
    let paths = AgentConfigPaths::new(
        agents_directory.join("config.toml"),
        agents_directory.join("credentials.toml"),
    )?;
    fs::write(paths.config_path(), shared_config)?;
    fs::write(paths.credentials_path(), shared_credentials)?;

    migrate_legacy_provider_config(&legacy_config_path, &legacy_credentials_path, &paths)?;

    assert_eq!(fs::read_to_string(paths.config_path())?, shared_config);
    assert_eq!(
        fs::read_to_string(paths.credentials_path())?,
        shared_credentials
    );
    Ok(())
}

#[test]
fn failed_legacy_credential_validation_does_not_publish_shared_config() -> anyhow::Result<()> {
    let fixture = TempDir::new()?;
    let legacy_directory = fixture.path().join("glossshift");
    let agents_directory = fixture.path().join("agents");
    fs::create_dir_all(&legacy_directory)?;
    let legacy_config_path = legacy_directory.join("config.toml");
    let legacy_credentials_path = legacy_directory.join("credentials.toml");
    fs::write(
        &legacy_config_path,
        format!(
            "active_provider = \"default\"\n[providers.default]\nbase_url = \"https://example.test/v1\"\nmodel = \"model\"\ncredential = \"default\"\n{DEFAULT_CONFIG}"
        ),
    )?;
    let paths = AgentConfigPaths::new(
        agents_directory.join("config.toml"),
        agents_directory.join("credentials.toml"),
    )?;

    assert!(
        migrate_legacy_provider_config(&legacy_config_path, &legacy_credentials_path, &paths)
            .is_err()
    );
    assert!(!paths.config_path().exists());
    assert!(!paths.credentials_path().exists());
    fs::write(
        &legacy_credentials_path,
        "[credentials.default]\napi_key = \"test-key\"\n",
    )?;

    migrate_legacy_provider_config(&legacy_config_path, &legacy_credentials_path, &paths)?;
    assert!(llm_profiles::load_from_paths(paths).is_ok());
    Ok(())
}

#[test]
fn malformed_legacy_provider_toml_does_not_expose_header_values() -> anyhow::Result<()> {
    let fixture = TempDir::new()?;
    let legacy_config_path = fixture.path().join("glossshift/config.toml");
    let legacy_credentials_path = fixture.path().join("glossshift/credentials.toml");
    let paths = AgentConfigPaths::new(
        fixture.path().join("agents/config.toml"),
        fixture.path().join("agents/credentials.toml"),
    )?;
    fs::create_dir_all(legacy_config_path.parent().unwrap_or(fixture.path()))?;
    fs::write(
        &legacy_config_path,
        "active_provider = \"default\"\n[providers.default.headers]\nauthorization = \"SECRET missing terminator\n",
    )?;

    let error =
        match migrate_legacy_provider_config(&legacy_config_path, &legacy_credentials_path, &paths)
        {
            Ok(()) => anyhow::bail!("malformed legacy TOML must fail"),
            Err(error) => error,
        };

    assert!(!format!("{error:#}").contains("SECRET"));
    assert!(!format!("{error:?}").contains("SECRET"));
    Ok(())
}

#[test]
fn migration_retries_after_credentials_destination_creation_failure() -> anyhow::Result<()> {
    let fixture = TempDir::new()?;
    let legacy_directory = fixture.path().join("glossshift");
    let agents_directory = fixture.path().join("agents");
    let blocked_parent = fixture.path().join("blocked");
    fs::create_dir_all(&legacy_directory)?;
    let legacy_config_path = legacy_directory.join("config.toml");
    let legacy_credentials_path = legacy_directory.join("credentials.toml");
    fs::write(
        &legacy_config_path,
        format!(
            "active_provider = \"default\"\n[providers.default]\nbase_url = \"https://example.test/v1\"\nmodel = \"model\"\ncredential = \"default\"\n{DEFAULT_CONFIG}"
        ),
    )?;
    fs::write(
        &legacy_credentials_path,
        "[credentials.default]\napi_key = \"test-key\"\n",
    )?;
    fs::write(&blocked_parent, "not a directory")?;
    let paths = AgentConfigPaths::new(
        agents_directory.join("config.toml"),
        blocked_parent.join("credentials.toml"),
    )?;

    assert!(
        migrate_legacy_provider_config(&legacy_config_path, &legacy_credentials_path, &paths)
            .is_err()
    );
    assert!(!paths.config_path().exists());
    fs::remove_file(&blocked_parent)?;
    fs::create_dir(&blocked_parent)?;

    migrate_legacy_provider_config(&legacy_config_path, &legacy_credentials_path, &paths)?;
    assert!(llm_profiles::load_from_paths(paths).is_ok());
    Ok(())
}
