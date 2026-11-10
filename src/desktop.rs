//! Composition-root bindings between the native desktop and popup controller.

use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    time::Duration,
};

use async_channel::Receiver;
use glossshift::llm::TranslationEvent;
use zgui::{
    platform::{AppMenu, MenuAction, Shortcut, Submenu},
    prelude::*,
    reactive::{LocalStorage, on_cleanup_local, spawn_local},
    runtime::desktop::{on_menu, on_reopen},
};

use crate::popup::{Pane, PopupController, PopupState};

pub const SHORTCUT_RELEASE_SETTLE_DELAY: Duration = Duration::from_millis(100);

type Controller = Rc<RefCell<PopupController>>;
type ViewState = RwSignal<PopupState, LocalStorage>;

pub fn menu() -> AppMenu {
    let action = |id, label, key: &str, modifiers| {
        MenuAction::new(id, label)
            .with_shortcut(Shortcut::new(Key::Character(key.into()), modifiers))
    };
    AppMenu::new()
        .with(Submenu::new("GlossShift").with(action(
            "quit",
            "Quit GlossShift",
            "q",
            Modifiers::META,
        )))
        .with(
            Submenu::new("Edit")
                .with(action(
                    "copy-translation",
                    "Copy translation",
                    "c",
                    Modifiers::META,
                ))
                .with(action(
                    "copy-source",
                    "Copy source",
                    "c",
                    Modifiers::META | Modifiers::SHIFT,
                )),
        )
        .with(Submenu::new("Window").with(action("hide", "Close window", "w", Modifiers::META)))
}

pub fn root(
    controller: Controller,
    shortcuts: Receiver<String>,
    events: Receiver<TranslationEvent>,
    quit: Receiver<()>,
    visible: Rc<Cell<bool>>,
) -> impl IntoView {
    let state = RwSignal::new_local(controller.borrow().snapshot());
    let window = use_window();
    let windows = use_windows();
    let copy = copy_action(controller.clone(), state);
    let close = on_close_request({
        let window = window.clone();
        move || {
            window.set_visible(false);
            CloseResponse::Veto
        }
    });
    on_cleanup_local(move || drop(close));
    let menu = on_menu({
        let copy = copy.clone();
        let window = window.clone();
        let windows = windows.clone();
        move |id| match id.as_str() {
            "quit" => windows.quit(),
            "hide" => window.set_visible(false),
            "copy-source" => copy(Pane::Source),
            "copy-translation" => copy(Pane::Translation),
            _ => {}
        }
    });
    on_cleanup_local(move || drop(menu));
    let reopen = on_reopen({
        let window = window.clone();
        let visible = visible.clone();
        move || {
            visible.set(true);
            window.set_visible(true);
            window.focus();
        }
    });
    on_cleanup_local(move || drop(reopen));

    spawn_shortcuts(controller.clone(), state, shortcuts, window, visible);
    spawn_local(async move {
        while let Ok(event) = events.recv().await {
            let mut controller = controller.borrow_mut();
            if controller.handle_event(event) {
                state.set(controller.snapshot());
            }
        }
    });
    spawn_local(async move {
        if quit.recv().await.is_ok() {
            windows.quit();
        }
    });
    crate::ui::popup_view(state, copy)
}

pub(crate) fn copy_action(controller: Controller, state: ViewState) -> Rc<dyn Fn(Pane)> {
    let clipboard = use_clipboard();
    Rc::new(move |pane| {
        let mut controller = controller.borrow_mut();
        clipboard.set_text(ClipboardKind::Standard, controller.text(pane).to_owned());
        controller.copied();
        state.set(controller.snapshot());
    })
}

fn spawn_shortcuts(
    controller: Controller,
    state: ViewState,
    receiver: Receiver<String>,
    window: WindowHandle,
    visible: Rc<Cell<bool>>,
) {
    spawn_local(async move {
        while let Ok(target_language) = receiver.recv().await {
            tokio::time::sleep(SHORTCUT_RELEASE_SETTLE_DELAY).await;
            // Capture the previous application's selection before showing or focusing.
            let mut controller = controller.borrow_mut();
            controller.trigger_translation(&target_language);
            state.set(controller.snapshot());
            drop(controller);
            visible.set(true);
            window.set_visible(true);
            window.focus();
        }
    });
}
