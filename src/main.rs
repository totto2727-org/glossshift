#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_imports))]

#[cfg(not(target_os = "macos"))]
compile_error!("translate-popup currently supports macOS only");

mod config;
mod llm;
mod prompt;
mod selection;
mod ui;

use std::{collections::HashMap, sync::Arc};

use anyhow::Context as _;
use async_channel::Receiver;
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState, hotkey::HotKey};
use gpui::{
    App, Application, Bounds, Global, KeyBinding, TitlebarOptions, WindowBounds, WindowKind,
    WindowOptions, prelude::*, px, size,
};

use crate::{
    config::LoadedConfig,
    llm::TranslationEvent,
    ui::{CloseWindow, CopySource, CopyTranslation, PopupView, Quit},
};

struct AppResources {
    _hotkey_manager: GlobalHotKeyManager,
    _network_thread: std::thread::JoinHandle<()>,
}

impl Global for AppResources {}

fn main() {
    if let Err(error) = run() {
        eprintln!("translate-popup failed to start: {error:#}");
    }
}

fn run() -> anyhow::Result<()> {
    let loaded = config::load_or_initialize()?;
    let hotkeys = loaded
        .app
        .shortcuts
        .iter()
        .map(|shortcut| shortcut.keys)
        .collect::<Vec<HotKey>>();
    let shortcut_targets = shortcut_targets(&loaded.app.shortcuts);
    let hotkey_manager = GlobalHotKeyManager::new().context("failed to create hotkey manager")?;
    hotkey_manager
        .register_all(&hotkeys)
        .context("failed to register configured shortcuts")?;

    let (shortcut_tx, shortcut_rx) = async_channel::bounded(8);
    GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
        if event.state == HotKeyState::Pressed
            && let Some(target_language) = shortcut_targets.get(&event.id)
        {
            let _ = shortcut_tx.try_send(target_language.clone());
        }
    }));

    let (request_tx, request_rx) = async_channel::bounded(4);
    let (event_tx, event_rx) = async_channel::bounded(256);
    let network_thread = llm::spawn_worker(request_rx, event_tx)?;
    let window_config = loaded.app.window.clone();
    let initial_status = initial_status(&loaded);
    let app_config = Arc::new(loaded.app);
    let api_key = loaded.api_key;

    Application::new().run(move |cx: &mut App| {
        cx.bind_keys([
            KeyBinding::new("cmd-q", Quit, None),
            KeyBinding::new("cmd-w", CloseWindow, None),
            KeyBinding::new("cmd-c", CopyTranslation, None),
            KeyBinding::new("cmd-shift-c", CopySource, None),
        ]);
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.on_action(|_: &CloseWindow, cx| cx.hide());
        cx.set_global(AppResources {
            _hotkey_manager: hotkey_manager,
            _network_thread: network_thread,
        });
        let bounds = Bounds::centered(
            None,
            size(px(window_config.width), px(window_config.height)),
            cx,
        );
        let result = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("Translate Popup".into()),
                    ..Default::default()
                }),
                kind: WindowKind::PopUp,
                is_resizable: true,
                window_min_size: Some(size(
                    px(window_config.min_width),
                    px(window_config.min_height),
                )),
                ..Default::default()
            },
            |window, cx| {
                window.on_window_should_close(cx, |_window, cx| {
                    cx.hide();
                    popup_should_close()
                });
                let view =
                    cx.new(|_| PopupView::new(app_config, api_key, request_tx, initial_status));
                let copy_source_view = view.downgrade();
                cx.on_action(move |_: &CopySource, cx| {
                    let _ = copy_source_view.update(cx, PopupView::copy_source);
                });
                let copy_translation_view = view.downgrade();
                cx.on_action(move |_: &CopyTranslation, cx| {
                    let _ = copy_translation_view.update(cx, PopupView::copy_translation);
                });
                spawn_shortcut_listener(window, cx, &view, shortcut_rx);
                spawn_llm_listener(window, cx, &view, event_rx);
                view
            },
        );
        if let Err(error) = result {
            eprintln!("failed to open translation popup: {error}");
            cx.quit();
            return;
        }
        cx.activate(true);
    });
    Ok(())
}

fn spawn_shortcut_listener(
    window: &gpui::Window,
    cx: &mut App,
    view: &gpui::Entity<PopupView>,
    receiver: Receiver<String>,
) {
    let view = view.downgrade();
    window
        .spawn(cx, async move |cx| {
            while let Ok(target_language) = receiver.recv().await {
                let _ = cx.update(|window, app| {
                    let _ = view.update(app, |view, cx| {
                        view.trigger_translation(target_language, cx);
                    });
                    window.activate_window();
                    app.activate(true);
                });
            }
        })
        .detach();
}

fn spawn_llm_listener(
    window: &gpui::Window,
    cx: &mut App,
    view: &gpui::Entity<PopupView>,
    receiver: Receiver<TranslationEvent>,
) {
    let view = view.downgrade();
    window
        .spawn(cx, async move |cx| {
            while let Ok(event) = receiver.recv().await {
                let _ = cx.update(|_window, app| {
                    let _ = view.update(app, |view, cx| view.handle_event(event, cx));
                });
            }
        })
        .detach();
}

fn initial_status(loaded: &LoadedConfig) -> String {
    if loaded.created_files {
        return format!("Created configuration in {}", loaded.directory.display());
    }
    if !macos_accessibility_client::accessibility::application_is_trusted() {
        return "Ready · clipboard fallback".into();
    }
    format!("Ready · {} shortcuts", loaded.app.shortcuts.len())
}

const fn popup_should_close() -> bool {
    false
}

fn shortcut_targets(shortcuts: &[config::ShortcutConfig]) -> HashMap<u32, String> {
    shortcuts
        .iter()
        .map(|shortcut| (shortcut.keys.id(), shortcut.target_language.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn keeps_popup_alive_when_close_is_requested() {
        // Given / When
        let should_close = popup_should_close();

        // Then
        assert!(!should_close);
    }
}
