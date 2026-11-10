use std::{cell::RefCell, collections::VecDeque, fs};

use async_channel::Receiver;
use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext, px, size};
use llm_profiles::AgentConfigPaths;
use tempfile::TempDir;

use super::*;
use crate::platform::SelectionSource;

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
    view: PopupView,
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
        let view = PopupView::new(
            Arc::new(config),
            Arc::new(agents),
            sender,
            "Ready".into(),
            Rc::new(FakeSelection(RefCell::new(selections.into()))),
        );
        Ok(Self {
            _directory: directory,
            view,
            requests,
        })
    }
}

fn fixture(selections: Vec<anyhow::Result<String>>, capacity: usize) -> Fixture {
    Fixture::new(selections, capacity).unwrap_or_else(|error| panic!("fixture failed: {error:#}"))
}

fn redraw(cx: &mut VisualTestContext) {
    cx.update(|window, app| {
        window.refresh();
        window.draw(app)
    })
    .clear();
}

fn copied_text(cx: &VisualTestContext) -> Option<String> {
    cx.read_from_clipboard().and_then(|item| item.text())
}

fn trigger(view: &Entity<PopupView>, cx: &mut VisualTestContext) {
    view.update(cx, |view, cx| {
        view.trigger_translation("Japanese".into(), cx);
    });
}

#[gpui::test]
fn ready_popup_renders_copy_controls_at_minimum_size(cx: &mut TestAppContext) {
    let fixture = fixture(vec![], 1);
    let minimum = size(
        px(fixture.view.config.window.min_width),
        px(fixture.view.config.window.min_height),
    );
    let (view, cx) = cx.add_window_view(|_, _| fixture.view);
    cx.simulate_resize(minimum);
    redraw(cx);

    for selector in ["copy-source", "copy-translation"] {
        let bounds = cx
            .debug_bounds(selector)
            .unwrap_or_else(|| panic!("missing control: {selector}"));
        assert!(bounds.size.width > px(0.0), "{selector} has no width");
        assert!(bounds.size.height > px(0.0), "{selector} has no height");
    }
    view.update(cx, PopupView::copy_translation);
    assert_eq!(
        copied_text(cx).as_deref(),
        Some("Select text in any application, then press a configured shortcut.")
    );
}

#[gpui::test]
fn selected_text_creates_a_translation_request(cx: &mut TestAppContext) {
    let fixture = fixture(vec![Ok("selected source".into())], 1);
    let (view, cx) = cx.add_window_view(|_, _| fixture.view);
    trigger(&view, cx);

    let request = fixture
        .requests
        .try_recv()
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(request.id, RequestId(1));
    assert_eq!(request.text, "selected source");
    assert_eq!(request.source_language, "auto");
    assert_eq!(request.target_language, "Japanese");
    view.update(cx, PopupView::copy_source);
    assert_eq!(copied_text(cx).as_deref(), Some("selected source"));
}

#[gpui::test]
fn completed_stream_is_copied_by_the_rendered_translation_control(cx: &mut TestAppContext) {
    let fixture = fixture(vec![Ok("source".into())], 1);
    let (view, cx) = cx.add_window_view(|_, _| fixture.view);
    trigger(&view, cx);
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
        view.update(cx, |view, cx| view.handle_event(event, cx));
    }
    redraw(cx);
    let bounds = cx
        .debug_bounds("copy-translation")
        .unwrap_or_else(|| panic!("missing translation copy control"));
    cx.simulate_click(bounds.center(), Modifiers::default());
    assert_eq!(copied_text(cx).as_deref(), Some("translated text"));
}

#[gpui::test]
fn rendered_source_control_copies_source_instead_of_translation(cx: &mut TestAppContext) {
    let fixture = fixture(vec![Ok("original source".into())], 1);
    let (view, cx) = cx.add_window_view(|_, _| fixture.view);
    trigger(&view, cx);
    redraw(cx);
    let bounds = cx
        .debug_bounds("copy-source")
        .unwrap_or_else(|| panic!("missing source copy control"));
    cx.simulate_click(bounds.center(), Modifiers::default());
    assert_eq!(copied_text(cx).as_deref(), Some("original source"));
}

#[gpui::test]
fn older_stream_events_cannot_replace_the_new_translation(cx: &mut TestAppContext) {
    let fixture = fixture(vec![Ok("old".into()), Ok("new".into())], 2);
    let (view, cx) = cx.add_window_view(|_, _| fixture.view);
    trigger(&view, cx);
    trigger(&view, cx);
    for event in [
        TranslationEvent::Started {
            id: RequestId(2),
            source_text: "new".into(),
        },
        TranslationEvent::Delta {
            id: RequestId(2),
            text: "current result".into(),
        },
        TranslationEvent::Started {
            id: RequestId(1),
            source_text: "stale source".into(),
        },
        TranslationEvent::Delta {
            id: RequestId(1),
            text: "stale delta".into(),
        },
        TranslationEvent::Finished { id: RequestId(1) },
        TranslationEvent::Failed {
            id: RequestId(1),
            message: "stale failure".into(),
        },
    ] {
        view.update(cx, |view, cx| view.handle_event(event, cx));
    }
    view.update(cx, PopupView::copy_translation);
    assert_eq!(copied_text(cx).as_deref(), Some("current result"));
    view.update(cx, PopupView::copy_source);
    assert_eq!(copied_text(cx).as_deref(), Some("new"));
}

#[gpui::test]
fn selection_failure_is_visible_without_queuing_a_request(cx: &mut TestAppContext) {
    let fixture = fixture(vec![Err(anyhow::anyhow!("No selected text"))], 1);
    let (view, cx) = cx.add_window_view(|_, _| fixture.view);
    trigger(&view, cx);
    assert!(matches!(
        fixture.requests.try_recv(),
        Err(async_channel::TryRecvError::Empty)
    ));
    view.update(cx, PopupView::copy_translation);
    assert_eq!(copied_text(cx).as_deref(), Some("No selected text"));
}

#[gpui::test]
fn full_queue_reports_a_recoverable_error(cx: &mut TestAppContext) {
    let fixture = fixture(vec![Ok("first".into()), Ok("second".into())], 1);
    let (view, cx) = cx.add_window_view(|_, _| fixture.view);
    trigger(&view, cx);
    trigger(&view, cx);
    view.update(cx, PopupView::copy_translation);
    assert_eq!(
        copied_text(cx).as_deref(),
        Some("The translation queue is busy. Try the shortcut again.")
    );
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

#[gpui::test]
fn matching_failure_is_visible_to_the_user(cx: &mut TestAppContext) {
    let fixture = fixture(vec![Ok("source".into())], 1);
    let (view, cx) = cx.add_window_view(|_, _| fixture.view);
    trigger(&view, cx);
    view.update(cx, |view, cx| {
        view.handle_event(
            TranslationEvent::Failed {
                id: RequestId(1),
                message: "Provider unavailable".into(),
            },
            cx,
        );
    });
    view.update(cx, PopupView::copy_translation);
    assert_eq!(copied_text(cx).as_deref(), Some("Provider unavailable"));
}
