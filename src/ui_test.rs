use std::{cell::RefCell, collections::VecDeque, fs, rc::Rc, sync::Arc};

use async_channel::Receiver;
use glossshift::llm::{RequestId, TranslationEvent, TranslationRequest};
use llm_profiles::AgentConfigPaths;
use tempfile::TempDir;

#[path = "ui_test_support.rs"]
mod support;

use support::MountedPopup;

use crate::{
    platform::SelectionSource,
    popup::{Pane, Phase, PopupController},
};

struct FakeSelection(RefCell<VecDeque<anyhow::Result<String>>>);

impl SelectionSource for FakeSelection {
    fn selected_text(&self) -> anyhow::Result<String> {
        self.0
            .borrow_mut()
            .pop_front()
            .unwrap_or_else(|| panic!("selection fixture exhausted"))
    }
}

struct Fixture {
    _directory: TempDir,
    controller: PopupController,
    requests: Receiver<TranslationRequest>,
}

impl Fixture {
    fn new(selections: Vec<anyhow::Result<String>>, capacity: usize) -> anyhow::Result<Self> {
        let directory = TempDir::new()?;
        let config_path = directory.path().join("config.toml");
        let credentials_path = directory.path().join("credentials.toml");
        fs::write(
            &config_path,
            "active_provider = \"test\"\n[providers.test]\nbase_url = \"https://example.test/v1\"\nmodel = \"test-model\"\ncredential = \"test\"\n",
        )?;
        fs::write(
            &credentials_path,
            "[credentials.test]\napi_key = \"synthetic-test-key\"\n",
        )?;
        let agents =
            llm_profiles::load_from_paths(AgentConfigPaths::new(config_path, credentials_path)?)?;
        let config = glossshift::config::parse_config(glossshift::config::DEFAULT_CONFIG)?;
        let (sender, requests) = async_channel::bounded(capacity);
        let controller = PopupController::new(
            Arc::new(config),
            Arc::new(agents),
            sender,
            "Ready".into(),
            Rc::new(FakeSelection(RefCell::new(selections.into()))),
        );
        Ok(Self {
            _directory: directory,
            controller,
            requests,
        })
    }
}

fn fixture(selections: Vec<anyhow::Result<String>>, capacity: usize) -> Fixture {
    Fixture::new(selections, capacity).unwrap_or_else(|error| panic!("fixture failed: {error:#}"))
}

fn trigger(controller: &mut PopupController) {
    controller.trigger_translation("Japanese");
}

fn late_events(id: RequestId) -> [TranslationEvent; 4] {
    [
        TranslationEvent::Started {
            id,
            source_text: "late source".into(),
        },
        TranslationEvent::Delta {
            id,
            text: "late delta".into(),
        },
        TranslationEvent::Finished { id },
        TranslationEvent::Failed {
            id,
            message: "late failure".into(),
        },
    ]
}

fn assert_late_events_preserve_state(controller: &mut PopupController, id: RequestId) {
    let expected = controller.snapshot();
    for event in late_events(id) {
        assert!(!controller.handle_event(event));
        assert_eq!(controller.snapshot(), expected);
    }
}

#[test]
fn selected_text_creates_a_translation_request() {
    let mut fixture = fixture(vec![Ok("selected source".into())], 1);
    trigger(&mut fixture.controller);
    let request = fixture
        .requests
        .try_recv()
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(request.id, RequestId(1));
    assert_eq!(request.text, "selected source");
    assert_eq!(request.source_language, "auto");
    assert_eq!(request.target_language, "Japanese");
    assert_eq!(fixture.controller.text(Pane::Source), "selected source");
    assert_eq!(fixture.controller.snapshot().phase, Phase::Streaming);
}

#[test]
fn completed_stream_concatenates_provider_deltas() {
    let mut fixture = fixture(vec![Ok("source".into())], 1);
    trigger(&mut fixture.controller);
    for event in [
        TranslationEvent::Started {
            id: RequestId(1),
            source_text: "source".into(),
        },
        TranslationEvent::Delta {
            id: RequestId(1),
            text: "translated ".into(),
        },
        TranslationEvent::Delta {
            id: RequestId(1),
            text: "text".into(),
        },
        TranslationEvent::Finished { id: RequestId(1) },
    ] {
        assert!(fixture.controller.handle_event(event));
    }
    assert_eq!(
        fixture.controller.text(Pane::Translation),
        "translated text"
    );
    assert_eq!(fixture.controller.snapshot().phase, Phase::Complete);
}

#[test]
fn older_stream_events_cannot_replace_the_new_translation() {
    let mut fixture = fixture(vec![Ok("old".into()), Ok("new".into())], 2);
    trigger(&mut fixture.controller);
    trigger(&mut fixture.controller);
    assert!(fixture.controller.handle_event(TranslationEvent::Delta {
        id: RequestId(2),
        text: "current result".into(),
    }));
    assert_late_events_preserve_state(&mut fixture.controller, RequestId(1));
    assert_eq!(fixture.controller.text(Pane::Translation), "current result");
    assert_eq!(fixture.controller.text(Pane::Source), "new");
}

#[test]
fn selection_failure_is_visible_without_queuing_a_request() {
    let mut fixture = fixture(vec![Err(anyhow::anyhow!("No selected text"))], 1);
    trigger(&mut fixture.controller);
    assert!(matches!(
        fixture.requests.try_recv(),
        Err(async_channel::TryRecvError::Empty)
    ));
    assert_eq!(
        fixture.controller.text(Pane::Translation),
        "No selected text"
    );
    assert_eq!(fixture.controller.snapshot().phase, Phase::Error);
}

#[test]
fn failed_selection_invalidates_the_previous_stream() {
    let mut fixture = fixture(
        vec![
            Ok("first".into()),
            Err(anyhow::anyhow!("Selection unavailable")),
        ],
        2,
    );
    trigger(&mut fixture.controller);
    trigger(&mut fixture.controller);
    assert_eq!(
        fixture.controller.text(Pane::Translation),
        "Selection unavailable"
    );
    assert_late_events_preserve_state(&mut fixture.controller, RequestId(1));
}

#[test]
fn full_queue_invalidates_the_previous_stream() {
    let mut fixture = fixture(vec![Ok("first".into()), Ok("second".into())], 1);
    trigger(&mut fixture.controller);
    trigger(&mut fixture.controller);
    assert_eq!(
        fixture.controller.text(Pane::Translation),
        "The translation queue is busy. Try the shortcut again."
    );
    assert_late_events_preserve_state(&mut fixture.controller, RequestId(1));
    let request = fixture
        .requests
        .try_recv()
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(request.text, "first");
    assert!(matches!(
        fixture.requests.try_recv(),
        Err(async_channel::TryRecvError::Empty)
    ));
}

#[test]
fn finished_stream_ignores_late_events() {
    let mut fixture = fixture(vec![Ok("source".into())], 1);
    trigger(&mut fixture.controller);
    for event in [
        TranslationEvent::Delta {
            id: RequestId(1),
            text: "complete result".into(),
        },
        TranslationEvent::Finished { id: RequestId(1) },
    ] {
        assert!(fixture.controller.handle_event(event));
    }
    assert_eq!(
        fixture.controller.text(Pane::Translation),
        "complete result"
    );
    assert_late_events_preserve_state(&mut fixture.controller, RequestId(1));
}

#[test]
fn failed_stream_ignores_late_events() {
    let mut fixture = fixture(vec![Ok("source".into())], 1);
    trigger(&mut fixture.controller);
    assert!(fixture.controller.handle_event(TranslationEvent::Failed {
        id: RequestId(1),
        message: "Provider unavailable".into(),
    }));
    assert_eq!(
        fixture.controller.text(Pane::Translation),
        "Provider unavailable"
    );
    assert_late_events_preserve_state(&mut fixture.controller, RequestId(1));
}

fn assert_controls_fit(popup: &MountedPopup, width: f32, height: f32) {
    for id in [
        "toggle-plaintext",
        "copy-source",
        "copy-translation",
        "source-scroll",
        "translation-scroll",
    ] {
        let bounds = if id.ends_with("-scroll") {
            popup.viewport_bounds(id)
        } else {
            popup.bounds(id)
        };
        assert!(
            bounds.size.width.0 > 0.0 && bounds.size.height.0 > 0.0,
            "{id}: {bounds:?}"
        );
        assert!(
            bounds.origin.x.0 >= 0.0 && bounds.origin.y.0 >= 0.0,
            "{id}: {bounds:?}"
        );
        assert!(
            bounds.origin.x.0 + bounds.size.width.0 <= width,
            "{id} overflows width: {bounds:?}"
        );
        assert!(
            bounds.origin.y.0 + bounds.size.height.0 <= height,
            "{id} overflows height: {bounds:?}"
        );
        if id.ends_with("-scroll") {
            assert!(
                bounds.size.height.0 >= 21.0,
                "{id} cannot show one text line: {bounds:?}"
            );
        }
    }
    let source = popup.viewport_bounds("source-scroll");
    let translation = popup.viewport_bounds("translation-scroll");
    assert!(
        source.origin.y.0 + source.size.height.0 <= translation.origin.y.0,
        "source {source:?} overlaps translation {translation:?}"
    );
}

#[test]
fn themed_popup_mounts_standard_controls_and_status_icon() {
    let popup = MountedPopup::new(560.0, 420.0);
    assert_controls_fit(&popup, 560.0, 420.0);
    assert_eq!(popup.text("popup-status"), "Ready");
    assert_eq!(popup.text("source-text"), "No text captured yet.");
    assert!(popup.count_named_nodes("control") >= 2);
    assert!(
        popup.count_named_nodes("vector") >= 1,
        "stock icon must mount its vector node"
    );
}

#[test]
fn clicking_source_control_writes_only_to_headless_clipboard() {
    let mut popup = MountedPopup::new(560.0, 420.0);
    popup.click("copy-source");
    assert_eq!(
        popup.clipboard_text().as_deref(),
        Some("No text captured yet.")
    );
    assert_eq!(popup.text("popup-status"), "Text copied");
}

#[test]
fn clicking_translation_control_copies_the_current_translation() {
    let mut popup = MountedPopup::new(560.0, 420.0);
    let expected = "# Heading\n\n**bold**";
    {
        let mut controller = popup.controller.borrow_mut();
        trigger(&mut controller);
        assert!(controller.handle_event(TranslationEvent::Delta {
            id: RequestId(1),
            text: expected.into()
        }));
        assert!(controller.handle_event(TranslationEvent::Finished { id: RequestId(1) }));
    }
    let state = popup.controller.borrow().snapshot();
    popup.publish(state);
    popup.click("copy-translation");
    assert_eq!(popup.clipboard_text().as_deref(), Some(expected));
    assert_eq!(popup.text("popup-status"), "Text copied");
    popup.click("toggle-plaintext");
    assert_eq!(popup.text("translation-text"), expected);
    popup.click("copy-translation");
    assert_eq!(popup.clipboard_text().as_deref(), Some(expected));
}

#[test]
fn plaintext_toggle_changes_both_panes_without_changing_their_markdown() {
    let mut popup = MountedPopup::new(560.0, 420.0);
    let mut state = popup.controller.borrow().snapshot();
    state.source_text = "# Source\n\n**original**".into();
    state.output = "# Translation\n\n**translated**".into();
    popup.publish(state.clone());
    assert_eq!(popup.text("source-text"), "Sourceoriginal");
    assert_eq!(popup.text("translation-text"), "Translationtranslated");

    popup.click("toggle-plaintext");
    assert_eq!(popup.text("source-text"), state.source_text);
    assert_eq!(popup.text("translation-text"), state.output);
    popup.click("toggle-plaintext");
    assert_eq!(popup.text("source-text"), "Sourceoriginal");
    assert_eq!(popup.text("translation-text"), "Translationtranslated");
}

#[test]
fn markdown_preview_uses_native_text_without_loading_external_resources() {
    let mut popup = MountedPopup::new(560.0, 420.0);
    let mut state = popup.controller.borrow().snapshot();
    state.output = "# Heading\n\n- first\n- second\n\n```rust\nlet value = 1;\n```\n\n[link](https://example.test) ![alternate](https://example.test/image.png)\n\n<script>danger()</script>".into();
    popup.publish(state);
    let rendered = popup.text("translation-text");
    for text in [
        "Heading",
        "• first",
        "• second",
        "let value = 1;",
        "link",
        "alternate",
        "<script>danger()</script>",
    ] {
        assert!(rendered.contains(text), "missing {text:?} in {rendered:?}");
    }
    assert!(!rendered.contains("```"));
    assert!(!rendered.contains("https://example.test"));
    for tag in ["image", "img", "webview", "script", "iframe"] {
        assert_eq!(
            popup.count_named_nodes(tag),
            0,
            "unexpected external or executable node {tag}"
        );
    }
}

#[test]
fn streaming_long_multiline_text_preserves_minimum_window_controls() {
    let config = glossshift::config::parse_config(glossshift::config::DEFAULT_CONFIG)
        .unwrap_or_else(|error| panic!("{error}"));
    let width = config.window.min_width;
    let height = config.window.min_height;
    let mut popup = MountedPopup::new(width, height);
    let mut state = popup.controller.borrow().snapshot();
    state.phase = Phase::Streaming;
    state.output.clear();
    state.status = "Translating to Japanese".into();
    popup.publish(state.clone());
    assert!(popup.find("streaming-indicator").is_some());
    assert_controls_fit(&popup, width, height);

    state.output = "A long translated line with many words. ".repeat(100)
        + &"\nAnother translated line.".repeat(100)
        + &"unbroken".repeat(500);
    state.source_text = "Selected source text\n".repeat(100) + &"unbroken-source".repeat(100);
    let expected = state.output.clone();
    popup.publish(state);
    assert!(popup.find("streaming-indicator").is_none());
    assert!(
        popup
            .text("translation-text")
            .contains(&"unbroken".repeat(500))
    );
    assert_controls_fit(&popup, width, height);
    popup.click("toggle-plaintext");
    assert_eq!(popup.text("translation-text"), expected);
    assert_controls_fit(&popup, width, height);
}
