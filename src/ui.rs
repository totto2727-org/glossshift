//! The native popup, built from zgui's standard themed components.

use std::rc::Rc;

use zgui::{prelude::*, reactive::LocalStorage};
use zgui_ui::prelude::*;
use zgui_ui_icons::{
    prelude::*,
    set::status::{ALERT_CIRCLE, CHECK_CIRCLE, INFO},
};
use zgui_ui_tokens::prelude::*;

use crate::popup::{Pane, Phase, PopupState};

pub const STYLESHEET: &str = include_str!("ui.css");

type ViewState = RwSignal<PopupState, LocalStorage>;

pub fn popup_view(state: ViewState, on_copy: Rc<dyn Fn(Pane)>) -> impl IntoView {
    let copy_source = Rc::clone(&on_copy);
    view! {
        ThemeProvider(scheme = ColorScheme::Dark) {
            column(
                class = "popup",
                attr:data-phase = move || Some(phase_name(state.with(|state| state.phase)).to_owned()),
                a11y:role = Role::Group,
                a11y:label = "GlossShift translation"
            ) {
                row(class = "popup__heading") {
                    text(class = "popup__title") {"GlossShift"}
                    {move || status_badge(state)}
                }
                Card(class = "popup__pane popup__source") {
                    CardHeader(class = "popup__pane-heading") {
                        CardTitle {"Source"}
                        CardAction {
                            Button(
                                variant = ButtonVariant::Ghost,
                                size = ButtonSize::Sm,
                                attr:data-testid = "copy-source",
                                a11y:label = "Copy source text",
                                on:click = move |_| copy_source(Pane::Source)
                            ) {"Copy"}
                        }
                    }
                    CardContent(class = "popup__pane-content") {
                        ScrollArea(
                            class = "popup__scroll",
                            label = "Source text",
                            attr:data-testid = "source-scroll"
                        ) {
                            text(class = "popup__text", attr:data-testid = "source-text") {
                                {move || state.with(|state| state.source_text.clone())}
                            }
                        }
                    }
                }
                Card(class = "popup__pane popup__translation") {
                    CardHeader(class = "popup__pane-heading") {
                        CardTitle {"Translation"}
                        CardAction {
                            Button(
                                variant = ButtonVariant::Ghost,
                                size = ButtonSize::Sm,
                                attr:data-testid = "copy-translation",
                                a11y:label = "Copy translation",
                                on:click = move |_| on_copy(Pane::Translation)
                            ) {"Copy"}
                        }
                    }
                    CardContent(class = "popup__pane-content") {
                        ScrollArea(
                            class = "popup__scroll",
                            label = "Translation text",
                            attr:data-testid = "translation-scroll"
                        ) {
                            if move || state.with(|state| state.phase == Phase::Streaming && state.output.is_empty()) {
                                row(class = "popup__waiting", attr:data-testid = "streaming-indicator") {
                                    Spinner(label = "Waiting for translation")
                                    text {"Waiting for the first streamed token…"}
                                }
                            }
                            text(class = "popup__text", attr:data-testid = "translation-text") {
                                {move || state.with(|state| state.output.clone())}
                            }
                        }
                    }
                }
            }
        }
    }
}

fn status_badge(state: ViewState) -> impl IntoView {
    let (variant, icon) = match state.with(|state| state.phase) {
        Phase::Ready => (BadgeVariant::Outline, INFO),
        Phase::Streaming => (BadgeVariant::Secondary, INFO),
        Phase::Complete => (BadgeVariant::Success, CHECK_CIRCLE),
        Phase::Error => (BadgeVariant::Destructive, ALERT_CIRCLE),
    };
    view! {
        Badge(
            variant = variant,
            class = "popup__status",
            attr:data-testid = "popup-status",
            a11y:role = Role::Status,
            a11y:live = zgui::vocab::Live::Polite
        ) {
            Icon(icon = icon, size = IconSize::Sm)
            text(class = "popup__status-text") {{move || state.with(|state| state.status.clone())}}
        }
    }
}

const fn phase_name(phase: Phase) -> &'static str {
    match phase {
        Phase::Ready => "ready",
        Phase::Streaming => "streaming",
        Phase::Complete => "complete",
        Phase::Error => "error",
    }
}

#[cfg(test)]
#[path = "ui_test.rs"]
mod tests;
