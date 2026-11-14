use super::*;
use global_hotkey::hotkey::{Code, Modifiers};
use tempfile::TempDir;

#[test]
fn parses_native_settings_without_translation_or_credentials() -> anyhow::Result<()> {
    let config = parse_config(DEFAULT_CONFIG)?;
    assert_eq!(config.shortcuts.len(), 1);
    assert_eq!(config.shortcuts[0].target_language, "Japanese");
    assert_eq!(
        config.shortcuts[0].keys.mods,
        Modifiers::CONTROL | Modifiers::SUPER
    );
    assert_eq!(config.shortcuts[0].keys.key, Code::KeyJ);
    assert!((config.window.width - 560.0).abs() < f32::EPSILON);
    Ok(())
}

#[test]
fn ignores_translation_and_obsolete_provider_sections() -> anyhow::Result<()> {
    let source = format!(
        "active_provider = \"obsolete\"\n[providers.obsolete]\nbase_url = \"https://example.invalid/v1\"\nmodel = \"unused\"\n[local_model]\npath = \"/local/model.gguf\"\n{DEFAULT_CONFIG}"
    );
    let config = parse_config(&source)?;
    assert_eq!(config.shortcuts[0].target_language, "Japanese");
    Ok(())
}

#[test]
fn rejects_invalid_window_dimensions() {
    assert!(parse_config(&DEFAULT_CONFIG.replace("width = 560", "width = 100")).is_err());
    for (field, original) in [
        ("width", "560"),
        ("height", "360"),
        ("min_width", "320"),
        ("min_height", "180"),
    ] {
        for value in ["nan", "inf", "-inf", "2147483648", "0", "-1"] {
            let source = DEFAULT_CONFIG.replace(
                &format!("{field} = {original}"),
                &format!("{field} = {value}"),
            );
            assert!(parse_config(&source).is_err(), "accepted {field} = {value}");
        }
    }
}

#[test]
fn rejects_invalid_shortcuts() {
    let duplicate = format!(
        "{DEFAULT_CONFIG}\n[[shortcuts]]\nkeys = \"Ctrl+Super+KeyJ\"\ntarget_language = \"English\"\n"
    );
    assert!(parse_config(&duplicate).is_err());
    assert!(
        parse_config(
            &DEFAULT_CONFIG.replace("target_language = \"Japanese\"", "target_language = \"\"")
        )
        .is_err()
    );
}

#[test]
fn initialization_never_overwrites_existing_configuration() -> anyhow::Result<()> {
    let directory = TempDir::new()?;
    let path = directory.path().join("config.toml");
    let original = "existing settings and provider data";
    fs::write(&path, original)?;
    assert!(!create_if_missing(&path, DEFAULT_CONFIG, 0o644)?);
    assert_eq!(fs::read_to_string(&path)?, original);
    Ok(())
}

#[test]
fn initialization_does_not_follow_a_destination_symlink() -> anyhow::Result<()> {
    let directory = TempDir::new()?;
    let target = directory.path().join("credentials.toml");
    let path = directory.path().join("config.toml");
    fs::write(&target, "private existing data")?;
    std::os::unix::fs::symlink(&target, &path)?;
    assert!(!create_if_missing(&path, DEFAULT_CONFIG, 0o644)?);
    assert_eq!(fs::read_to_string(&target)?, "private existing data");
    Ok(())
}

#[test]
fn creates_only_the_requested_application_file() -> anyhow::Result<()> {
    let directory = TempDir::new()?;
    let path = directory.path().join("glossshift/config.toml");
    assert!(create_if_missing(&path, DEFAULT_CONFIG, 0o644)?);
    assert_eq!(fs::read_to_string(&path)?, DEFAULT_CONFIG);
    assert!(!directory.path().join("agents").exists());
    assert!(
        !directory
            .path()
            .join("glossshift/credentials.toml")
            .exists()
    );
    Ok(())
}
