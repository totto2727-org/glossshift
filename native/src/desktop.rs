//! `AppKit` services. NSH owns the only native event loop.

use crate::{
    dispatch::on_main, platform::SelectionSource as _, selection::MacOsSelection,
    services::services, shortcuts::Shortcuts,
};
use global_hotkey::{GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState};
use std::{cell::RefCell, collections::HashMap};
use tokio_util::sync::CancellationToken;

thread_local! {
    static NATIVE: RefCell<Option<NativeServices>> = const { RefCell::new(None) };
}
struct NativeServices {
    _hotkeys: GlobalHotKeyManager,
    shortcuts: Shortcuts,
}

pub async fn initialize() -> Result<(), String> {
    on_main(|_| install_main()).await
}

fn install_main() -> Result<(), String> {
    NATIVE.with(|native| {
        if native.borrow().is_some() {
            return Ok(());
        }
        let service = services()?;
        let targets: HashMap<_, _> = service
            .loaded
            .app
            .shortcuts
            .iter()
            .map(|shortcut| (shortcut.keys.id(), shortcut.target_language.clone()))
            .collect();
        let hotkeys = GlobalHotKeyManager::new().map_err(|error| error.to_string())?;
        for shortcut in &service.loaded.app.shortcuts {
            hotkeys
                .register(shortcut.keys)
                .map_err(|error| error.to_string())?;
        }
        let (shortcuts, receiver) = Shortcuts::new();
        let current = shortcuts.clone();
        GlobalHotKeyEvent::set_event_handler(Some(move |event: GlobalHotKeyEvent| {
            if event.state == HotKeyState::Released
                && let Some(target) = targets.get(&event.id)
            {
                current.push(target.clone());
            }
        }));
        service.runtime.spawn(crate::shortcuts::run(
            receiver,
            shortcuts.stopped.clone(),
            service.clone(),
        ));
        *native.borrow_mut() = Some(NativeServices {
            _hotkeys: hotkeys,
            shortcuts,
        });
        Ok(())
    })
}

pub fn setup(options: &mut nsh_platform_macos::AppOptions) -> Result<bool, String> {
    let Some(background) = crate::startup::configure()? else {
        return Ok(false);
    };
    let service = services()?;
    let window = &service.loaded.app.window;
    options.title = "GlossShift".into();
    options.app_id = "com.totto2727.glossshift".into();
    options.size = (dimension(window.width), dimension(window.height));
    options.min_size = Some((dimension(window.min_width), dimension(window.min_height)));
    options.initially_hidden = background;
    options.keep_alive_on_close = true;
    install_main()?;
    Ok(true)
}

#[allow(clippy::cast_possible_truncation)]
fn dimension(value: f32) -> i32 {
    value.round().max(1.0) as i32
}

pub fn shutdown() {
    NATIVE.with(|native| {
        if let Some(native) = native.borrow_mut().take() {
            native.shortcuts.close();
        }
    });
    if let Some(service) = crate::services::started_services() {
        service.close();
    }
}

pub async fn capture() -> Result<String, String> {
    capture_current(CancellationToken::new()).await
}

pub async fn capture_current(token: CancellationToken) -> Result<String, String> {
    on_main(move |_| {
        if token.is_cancelled() {
            return Err("selection capture superseded".into());
        }
        MacOsSelection
            .selected_text()
            .map_err(|error| format!("{error:#}"))
    })
    .await
}

pub async fn reveal_current(token: CancellationToken) -> Result<(), String> {
    on_main(move |_| {
        if !token.is_cancelled() {
            nsh_platform_macos::show_app();
        }
        Ok(())
    })
    .await
}
