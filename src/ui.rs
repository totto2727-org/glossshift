use std::sync::Arc;

use async_channel::Sender;
use gpui::{
    ClipboardItem, Context, IntoElement, Render, SharedString, Window, actions, div, prelude::*,
    rgb,
};

use glossshift::{
    config::AppConfig,
    llm::{RequestId, TranslationEvent, TranslationRequest},
};

use crate::selection;

actions!(
    glossshift,
    [CloseWindow, CopySource, CopyTranslation, Quit,]
);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Phase {
    Ready,
    Streaming,
    Complete,
    Error,
}

#[derive(Clone, Copy)]
enum Pane {
    Source,
    Translation,
}

pub struct PopupView {
    config: Arc<AppConfig>,
    api_key: String,
    requests: Sender<TranslationRequest>,
    next_request_id: u64,
    active_request: Option<RequestId>,
    source_text: SharedString,
    output: SharedString,
    status: SharedString,
    phase: Phase,
}

impl PopupView {
    pub fn new(
        config: Arc<AppConfig>,
        api_key: String,
        requests: Sender<TranslationRequest>,
        initial_status: String,
    ) -> Self {
        Self {
            config,
            api_key,
            requests,
            next_request_id: 1,
            active_request: None,
            source_text: "No text captured yet.".into(),
            output: "Select text in any application, then press a configured shortcut.".into(),
            status: initial_status.into(),
            phase: Phase::Ready,
        }
    }

    pub fn trigger_translation(&mut self, target_language: String, cx: &mut Context<Self>) {
        let text = match selection::selected_text() {
            Ok(text) => text,
            Err(error) => {
                self.fail(format!("{error:#}"), cx);
                return;
            }
        };
        let provider = match self.config.provider() {
            Ok(provider) => provider.clone(),
            Err(error) => {
                self.fail(format!("{error:#}"), cx);
                return;
            }
        };
        if self.api_key.trim().is_empty() || self.api_key == "replace-me" {
            self.fail(
                "Set api_key in ~/.config/glossshift/credentials.toml, then restart the app."
                    .into(),
                cx,
            );
            return;
        }

        let id = RequestId(self.next_request_id);
        self.next_request_id = self.next_request_id.saturating_add(1);
        let status = format!("Translating to {target_language}");
        let request = TranslationRequest {
            id,
            provider,
            api_key: self.api_key.clone(),
            source_language: self.config.translation.source_language.clone(),
            target_language,
            text: text.clone(),
        };
        if self.requests.try_send(request).is_err() {
            self.fail(
                "The translation queue is busy. Try the shortcut again.".into(),
                cx,
            );
            return;
        }
        self.active_request = Some(id);
        self.source_text = text.into();
        self.output = "Waiting for the first streamed token…".into();
        self.status = status.into();
        self.phase = Phase::Streaming;
        cx.notify();
    }

    pub fn handle_event(&mut self, event: TranslationEvent, cx: &mut Context<Self>) {
        let id = event.request_id();
        if self.active_request != Some(id) {
            return;
        }
        match event {
            TranslationEvent::Started { source_text, .. } => {
                self.source_text = source_text.into();
                self.output = SharedString::default();
                self.phase = Phase::Streaming;
            }
            TranslationEvent::Delta { text, .. } => {
                let mut output = self.output.to_string();
                output.push_str(&text);
                self.output = output.into();
            }
            TranslationEvent::Finished { .. } => {
                self.status = "Translation complete".into();
                self.phase = Phase::Complete;
            }
            TranslationEvent::Failed { message, .. } => self.fail(message, cx),
        }
        cx.notify();
    }

    fn fail(&mut self, message: String, cx: &mut Context<Self>) {
        self.output = message.into();
        self.status = "Action required".into();
        self.phase = Phase::Error;
        cx.notify();
    }

    fn copy_pane(&mut self, pane: Pane, cx: &mut Context<Self>) {
        let text = match pane {
            Pane::Source => self.source_text.to_string(),
            Pane::Translation => self.output.to_string(),
        };
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        self.status = "Text copied".into();
        cx.notify();
    }

    pub fn copy_source(&mut self, cx: &mut Context<Self>) {
        self.copy_pane(Pane::Source, cx);
    }

    pub fn copy_translation(&mut self, cx: &mut Context<Self>) {
        self.copy_pane(Pane::Translation, cx);
    }

    fn pane_header(pane: Pane, cx: &mut Context<Self>) -> impl IntoElement {
        let (label, id) = match pane {
            Pane::Source => ("SOURCE", "copy-source"),
            Pane::Translation => ("TRANSLATION", "copy-translation"),
        };
        div()
            .flex()
            .items_center()
            .justify_between()
            .child(div().text_xs().text_color(rgb(0x0094_a3b8)).child(label))
            .child(
                div()
                    .id(id)
                    .cursor_pointer()
                    .rounded_md()
                    .px_2()
                    .py_1()
                    .text_xs()
                    .text_color(rgb(0x00cb_d5e1))
                    .hover(|style| style.bg(rgb(0x0037_4151)))
                    .child("COPY")
                    .on_click(cx.listener(move |this, _, _, cx| this.copy_pane(pane, cx))),
            )
    }
}

impl Render for PopupView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let accent = match self.phase {
            Phase::Ready => rgb(0x0094_a3b8),
            Phase::Streaming => rgb(0x0060_a5fa),
            Phase::Complete => rgb(0x0034_d399),
            Phase::Error => rgb(0x00fb_7185),
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .gap_4()
            .p_5()
            .bg(rgb(0x0011_1827))
            .text_color(rgb(0x00e5_e7eb))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_lg()
                            .font_weight(gpui::FontWeight::SEMIBOLD)
                            .child("GlossShift"),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(accent)
                            .child(self.status.clone()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(Self::pane_header(Pane::Source, cx))
                    .child(
                        div()
                            .id("source-scroll")
                            .max_h_24()
                            .overflow_y_scroll()
                            .p_3()
                            .rounded_lg()
                            .bg(rgb(0x001f_2937))
                            .text_sm()
                            .child(self.source_text.clone()),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .gap_2()
                    .child(Self::pane_header(Pane::Translation, cx))
                    .child(
                        div()
                            .id("translation-scroll")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .p_3()
                            .rounded_lg()
                            .border_1()
                            .border_color(rgb(0x0037_4151))
                            .bg(rgb(0x000f_172a))
                            .text_base()
                            .child(self.output.clone()),
                    ),
            )
    }
}
