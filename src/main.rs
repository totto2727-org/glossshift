#![cfg_attr(not(target_os = "macos"), allow(dead_code, unused_imports))]

#[cfg(not(target_os = "macos"))]
compile_error!("glossshift currently supports macOS only");

mod autostart;
mod desktop;
mod desktop_driver;
mod platform;
mod popup;
mod selection;
mod tray;
mod ui;

use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    rc::Rc,
    sync::Arc,
};

use anyhow::Context as _;
use clap::{Parser, Subcommand};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState, hotkey::HotKey};
use zgui::prelude::*;

use glossshift::{config, config::LoadedConfig, llm};

use crate::{platform::AccessibilityPermission, popup::PopupController, selection::MacOsSelection};

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
    let (quit_tx, quit_rx) = async_channel::bounded(1);
    let tokio_runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .context("failed to create Tokio runtime")?;
    let _tokio = zgui::tokio::install_handle(tokio_runtime.handle().clone())?;
    let network_task = tokio_runtime.spawn(llm::run_worker(request_rx, event_tx));
    let selection = Rc::new(MacOsSelection);
    let initial_status = initial_status(&loaded, selection.as_ref());
    let window = loaded.app.window.clone();
    let controller = Rc::new(RefCell::new(PopupController::new(
        Arc::new(loaded.app),
        loaded.agents,
        request_tx,
        initial_status,
        selection,
    )));
    let visible = Rc::new(Cell::new(!arguments.background));
    let driver_visible = visible.clone();
    let result = zgui::app()
        .with_application_id("com.totto2727.glossshift")
        .with_title("GlossShift")
        .with_size(window.width, window.height)
        .with_min_size(window.min_width, window.min_height)
        .with_resizable(true)
        .with_decorations(Decorations::Full)
        .with_exit_policy(ExitPolicy::Explicit)
        .with_menu(desktop::menu)
        .with_stylesheet(ui::STYLESHEET)
        .run_on(
            move |handler| {
                zgui::app::desktop()(Box::new(desktop_driver::DesktopDriver::new(
                    handler,
                    driver_visible,
                    quit_tx,
                )))
            },
            move || {
                desktop::root(
                    controller.clone(),
                    shortcut_rx.clone(),
                    event_rx.clone(),
                    quit_rx.clone(),
                    visible.clone(),
                )
            },
        );
    network_task.abort();
    drop(hotkey_manager);
    result.context("failed to run translation popup")
}

fn initial_status(loaded: &LoadedConfig, permission: &impl AccessibilityPermission) -> String {
    if loaded.created_files {
        return format!("Created configuration in {}", loaded.directory.display());
    }
    if !permission.is_granted() {
        return "Ready · Accessibility permission required".into();
    }
    format!("Ready · {} shortcuts", loaded.app.shortcuts.len())
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
