#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_imports))]

#[cfg(not(target_os = "macos"))]
compile_error!("glossshift currently supports macOS only");

mod autostart;
mod selection;
mod tray;
mod ui;

use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::Context as _;
use async_channel::Receiver;
use clap::{Parser, Subcommand};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState, hotkey::HotKey};
use gpui::{
    App, Application, Bounds, Global, KeyBinding, TitlebarOptions, WindowBounds, WindowKind,
    WindowOptions, prelude::*, px, size,
};

use glossshift::{
    config,
    config::LoadedConfig,
    llm::{self, TranslationEvent},
};

use crate::ui::{CloseWindow, CopySource, CopyTranslation, PopupView, Quit};

const SHORTCUT_RELEASE_SETTLE_DELAY: Duration = Duration::from_millis(100);

#[derive(Parser)]
#[command(
    version,
    about = "GlossShift menu bar translation application",
    args_conflicts_with_subcommands = true
)]
struct Arguments {
    /// Start with the popup hidden, without activating the application.
    #[arg(long)]
    background: bool,
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Configure automatic startup at the next macOS login.
    Autostart {
        #[command(subcommand)]
        command: autostart::AutostartCommand,
    },
}

struct AppResources {
    _hotkey_manager: GlobalHotKeyManager,
    _network_task: tokio::task::JoinHandle<()>,
    _tokio_runtime: tokio::runtime::Runtime,
}

impl Global for AppResources {}

fn main() -> std::process::ExitCode {
    if let Err(error) = run(Arguments::parse()) {
        eprintln!("glossshift failed to start: {error:#}");
        return std::process::ExitCode::FAILURE;
    }
    std::process::ExitCode::SUCCESS
}

fn run(arguments: Arguments) -> anyhow::Result<()> {
    if let Some(Command::Autostart { command }) = arguments.command {
        return autostart::run(command);
    }
    let background = arguments.background;
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
        if let Some(target_language) = shortcut_target(event, &shortcut_targets) {
            let _ = shortcut_tx.try_send(target_language.to_owned());
        }
    }));

    let (request_tx, request_rx) = async_channel::bounded(4);
    let (event_tx, event_rx) = async_channel::bounded(256);
    let tokio_runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .context("failed to create Tokio runtime")?;
    let network_task = tokio_runtime.spawn(llm::run_worker(request_rx, event_tx));
    let window_config = loaded.app.window.clone();
    let initial_status = initial_status(&loaded);
    let app_config = Arc::new(loaded.app);
    let api_key = loaded.api_key;

    Application::new().run(move |cx: &mut App| {
        cx.defer(|cx| {
            if let Err(error) = tray::install(cx) {
                eprintln!("failed to create menu bar icon: {error:#}");
                cx.quit();
            }
        });
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
            _network_task: network_task,
            _tokio_runtime: tokio_runtime,
        });
        let result = cx.open_window(
            popup_options(&window_config, background, cx),
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
        if !background {
            cx.activate(true);
        }
    });
    Ok(())
}

fn popup_options(config: &config::WindowConfig, background: bool, cx: &App) -> WindowOptions {
    let bounds = Bounds::centered(None, size(px(config.width), px(config.height)), cx);
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(bounds)),
        titlebar: Some(TitlebarOptions {
            title: Some("GlossShift".into()),
            ..Default::default()
        }),
        kind: WindowKind::PopUp,
        show: !background,
        focus: !background,
        is_resizable: true,
        window_min_size: Some(size(px(config.min_width), px(config.min_height))),
        ..Default::default()
    }
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
                cx.background_executor()
                    .timer(SHORTCUT_RELEASE_SETTLE_DELAY)
                    .await;
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
        return "Ready · Accessibility permission required".into();
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

fn shortcut_target(event: GlobalHotKeyEvent, targets: &HashMap<u32, String>) -> Option<&str> {
    if event.state != HotKeyState::Released {
        return None;
    }
    targets.get(&event.id).map(String::as_str)
}

#[cfg(test)]
#[path = "main_test.rs"]
mod tests;
