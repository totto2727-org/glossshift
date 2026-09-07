use super::*;

#[test]
fn command_line_definition_is_consistent() {
    use clap::CommandFactory as _;
    Arguments::command().debug_assert();
}

#[test]
fn background_startup_is_explicit() -> anyhow::Result<()> {
    let arguments = Arguments::try_parse_from(["glossshift", "--background"])?;
    assert!(arguments.background);
    assert!(arguments.command.is_none());
    Ok(())
}

#[test]
fn normal_startup_remains_visible() -> anyhow::Result<()> {
    let arguments = Arguments::try_parse_from(["glossshift"])?;
    assert!(!arguments.background);
    assert!(arguments.command.is_none());
    Ok(())
}

#[test]
fn background_cannot_be_combined_with_autostart_configuration() {
    let result = Arguments::try_parse_from(["glossshift", "--background", "autostart", "status"]);
    let Err(error) = result else {
        panic!("startup and configuration modes must conflict");
    };
    assert_eq!(error.kind(), clap::error::ErrorKind::ArgumentConflict);
}

#[test]
fn routes_hotkeys_to_configured_target_languages() {
    // Given
    let source = format!(
        "{}\n[[shortcuts]]\nkeys = \"Ctrl+Super+KeyE\"\ntarget_language = \"English\"\n",
        config::DEFAULT_CONFIG
    );
    let app = config::parse_config(&source).unwrap_or_else(|error| panic!("{error}"));

    // When
    let targets = shortcut_targets(&app.shortcuts);

    // Then
    assert_eq!(
        targets.get(&app.shortcuts[0].keys.id()).map(String::as_str),
        Some("Japanese")
    );
    assert_eq!(
        targets.get(&app.shortcuts[1].keys.id()).map(String::as_str),
        Some("English")
    );
}

#[test]
fn dispatches_hotkey_on_release_event() {
    // Given
    let source =
        config::parse_config(config::DEFAULT_CONFIG).unwrap_or_else(|error| panic!("{error}"));
    let targets = shortcut_targets(&source.shortcuts);
    let id = source.shortcuts[0].keys.id();
    let pressed = GlobalHotKeyEvent {
        id,
        state: HotKeyState::Pressed,
    };
    let released = GlobalHotKeyEvent {
        id,
        state: HotKeyState::Released,
    };

    // When
    let target_while_pressed = shortcut_target(pressed, &targets);
    let target_after_release = shortcut_target(released, &targets);

    // Then
    assert_eq!(target_while_pressed, None);
    assert_eq!(target_after_release, Some("Japanese"));
}

#[test]
fn keeps_popup_alive_when_close_is_requested() {
    // Given / When
    let should_close = popup_should_close();

    // Then
    assert!(!should_close);
}
