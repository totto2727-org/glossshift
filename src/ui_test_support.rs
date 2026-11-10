use std::{cell::RefCell, rc::Rc};

use zgui::{
    geom::{Css, CssPx, Device, DevicePx, Point, Rect, Size},
    platform::{ClipboardFormat, ClipboardKind, PlatformCx, SurfaceEvent},
    reactive::{LocalStorage, RwSignal, prelude::*},
    runtime::{Runtime, Window},
    view::ViewHost,
    vocab::{Modifiers, PointerAction, PointerButton, PointerEvent, Timestamp},
};
use zgui_dom::NodeKey;
use zgui_platform_headless::Harness;

use super::{Fixture, fixture};
use crate::{
    popup::{PopupController, PopupState},
    ui::{STYLESHEET, popup_view},
};

#[path = "ui_test_renderer.rs"]
mod renderer;

type StateSignal = RwSignal<PopupState, LocalStorage>;

pub(super) struct MountedPopup {
    pub harness: Harness<Runtime>,
    pub controller: Rc<RefCell<PopupController>>,
    pub state: StateSignal,
    _directory: tempfile::TempDir,
    _requests: async_channel::Receiver<glossshift::llm::TranslationRequest>,
}

impl MountedPopup {
    pub fn new(width: f32, height: f32) -> Self {
        let Fixture {
            _directory: directory,
            controller,
            requests,
        } = fixture(vec![Ok("selected source".into())], 1);
        let initial = controller.snapshot();
        let controller = Rc::new(RefCell::new(controller));
        let captured = Rc::new(RefCell::new(None));
        let capture = captured.clone();
        let view_controller = controller.clone();
        let runtime = zgui::app()
            .with_size(width, height)
            .with_stylesheet(STYLESHEET)
            .with_renderer(Box::new(|_, target| {
                Ok(Box::new(renderer::HeadlessRenderer::new(target)))
            }))
            .into_handler(move || {
                let state = RwSignal::new_local(initial.clone());
                *capture.borrow_mut() = Some(state);
                popup_view(
                    state,
                    crate::desktop::copy_action(view_controller.clone(), state),
                )
            })
            .unwrap_or_else(|error| panic!("headless popup build failed: {error}"))
            .into_runtime();
        let mut harness = Harness::new(runtime);
        harness.deliver_to_first(SurfaceEvent::Resized(Size::new(
            DevicePx(width),
            DevicePx(height),
        )));
        harness.settle(16);
        let state = captured
            .borrow()
            .unwrap_or_else(|| panic!("popup never mounted"));
        assert!(
            harness.app().failure().take().is_none(),
            "headless frame failed"
        );
        Self {
            harness,
            controller,
            state,
            _directory: directory,
            _requests: requests,
        }
    }

    pub fn window(&self) -> &Window {
        &self.harness.app().windows()[0]
    }

    pub fn find(&self, test_id: &str) -> Option<NodeKey> {
        let doc = self.window().document().borrow();
        let mut pending = vec![doc.root()?];
        while let Some(node) = pending.pop() {
            if node
                .attr("data-testid")
                .is_some_and(|value| value.as_str() == test_id)
            {
                return Some(node.key());
            }
            let mut child = node.first_child_node();
            while let Some(next) = child {
                pending.push(next);
                child = next.next_sibling_node();
            }
        }
        None
    }

    pub fn bounds(&self, test_id: &str) -> Rect<DevicePx, Device> {
        let node = self
            .find(test_id)
            .unwrap_or_else(|| panic!("missing {test_id}"));
        self.window()
            .host()
            .window_box(zgui_view_dom::id::to_view(node))
            .unwrap_or_else(|| panic!("{test_id} has no layout bounds"))
    }

    pub fn text(&self, test_id: &str) -> String {
        let node = self
            .find(test_id)
            .unwrap_or_else(|| panic!("missing {test_id}"));
        self.window()
            .dom()
            .text_content(zgui_view_dom::id::to_view(node))
    }

    pub fn viewport_bounds(&self, test_id: &str) -> Rect<DevicePx, Device> {
        let key = self
            .find(test_id)
            .unwrap_or_else(|| panic!("missing {test_id}"));
        let doc = self.window().document().borrow();
        let record = doc
            .store()
            .get(key)
            .unwrap_or_else(|| panic!("stale {test_id}"));
        let mut node = zgui_dom::Node::new(record).first_child_node();
        while let Some(child) = node {
            if child.record().local_name().as_str() == "scroll" {
                return self
                    .window()
                    .host()
                    .window_box(zgui_view_dom::id::to_view(child.key()))
                    .unwrap_or_else(|| panic!("missing viewport box for {test_id}"));
            }
            node = child.next_sibling_node();
        }
        panic!("no actual scroll viewport in {test_id}");
    }

    pub fn publish(&mut self, state: PopupState) {
        self.state.set(state);
        self.window().request_frame();
        self.harness.settle(16);
        assert!(
            self.harness.app().failure().take().is_none(),
            "updated headless frame failed"
        );
    }

    pub fn click(&mut self, test_id: &str) {
        let bounds = self.bounds(test_id);
        let at: Point<CssPx, Css> = Point::new(
            CssPx(bounds.origin.x.0 + bounds.size.width.0 / 2.0),
            CssPx(bounds.origin.y.0 + bounds.size.height.0 / 2.0),
        );
        for action in [
            PointerAction::Moved,
            PointerAction::Pressed,
            PointerAction::Released,
        ] {
            self.harness.deliver_to_first(SurfaceEvent::Pointer {
                action,
                event: if action == PointerAction::Moved {
                    PointerEvent::mouse(at)
                } else {
                    PointerEvent::mouse(at).with_button(PointerButton::Primary)
                },
                modifiers: Modifiers::NONE,
                timestamp: Timestamp::ORIGIN,
            });
            self.harness.settle(16);
        }
    }

    pub fn clipboard_text(&self) -> Option<String> {
        self.harness
            .platform()
            .clipboard()
            .read_blocking(ClipboardKind::Standard, ClipboardFormat::Text)
            .ok()
            .and_then(|data| data.as_text().map(str::to_owned))
    }

    pub fn count_named_nodes(&self, name: &str) -> usize {
        let doc = self.window().document().borrow();
        let Some(root) = doc.root() else { return 0 };
        let mut pending = vec![root];
        let mut count = 0;
        while let Some(node) = pending.pop() {
            if node.record().local_name().as_str() == name {
                count += 1;
            }
            let mut child = node.first_child_node();
            while let Some(next) = child {
                pending.push(next);
                child = next.next_sibling_node();
            }
        }
        count
    }
}

struct DesktopFixture {
    harness: Harness<crate::desktop_driver::DesktopDriver>,
    shortcuts: async_channel::Sender<String>,
    quit: async_channel::Sender<()>,
    requests: async_channel::Receiver<glossshift::llm::TranslationRequest>,
    _directory: tempfile::TempDir,
}

impl DesktopFixture {
    fn new() -> Self {
        let Fixture {
            _directory: directory,
            controller,
            requests,
        } = fixture(vec![Ok("selected source".into())], 1);
        let controller = Rc::new(RefCell::new(controller));
        let visible = Rc::new(std::cell::Cell::new(false));
        let view_visible = visible.clone();
        let (shortcuts, shortcut_rx) = async_channel::bounded(1);
        let (_events, event_rx) = async_channel::bounded(1);
        let (quit, quit_rx) = async_channel::bounded(1);
        let runtime = zgui::app()
            .with_stylesheet(STYLESHEET)
            .with_renderer(Box::new(|_, target| {
                Ok(Box::new(renderer::HeadlessRenderer::new(target)))
            }))
            .into_handler(move || {
                crate::desktop::root(
                    controller.clone(),
                    shortcut_rx.clone(),
                    event_rx.clone(),
                    quit_rx.clone(),
                    view_visible.clone(),
                )
            })
            .unwrap_or_else(|error| panic!("desktop app failed: {error}"))
            .into_runtime();
        let driver = crate::desktop_driver::DesktopDriver::headless(Box::new(runtime), visible);
        let mut harness = Harness::new(driver);
        harness.pump();
        Self {
            harness,
            shortcuts,
            quit,
            requests,
            _directory: directory,
        }
    }

    fn visible(&self) -> bool {
        self.harness
            .platform()
            .offscreens()
            .into_iter()
            .next()
            .unwrap_or_else(|| panic!("no headless surface"))
            .is_visible()
    }
}

#[test]
fn hidden_startup_reveals_after_shortcut_channel_and_tokio_timer_wakes() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_time()
        .build()
        .unwrap_or_else(|error| panic!("Tokio test runtime failed: {error}"));
    let _entered = runtime.enter();
    let mut desktop = DesktopFixture::new();
    assert!(
        !desktop.visible(),
        "background startup flashed its first frame"
    );
    desktop
        .shortcuts
        .try_send("Japanese".into())
        .unwrap_or_else(|error| panic!("{error}"));
    desktop.harness.settle(16);
    assert!(
        !desktop.visible(),
        "selection capture settle delay was skipped"
    );
    assert!(matches!(
        desktop.requests.try_recv(),
        Err(async_channel::TryRecvError::Empty)
    ));

    runtime.block_on(async {
        tokio::time::sleep(
            crate::desktop::SHORTCUT_RELEASE_SETTLE_DELAY + std::time::Duration::from_millis(20),
        )
        .await;
    });
    desktop.harness.settle(16);
    assert!(
        desktop.visible(),
        "Tokio wake did not release the first frame"
    );
    let request = desktop
        .requests
        .try_recv()
        .unwrap_or_else(|error| panic!("{error}"));
    assert_eq!(request.text, "selected source");
    assert_eq!(request.target_language, "Japanese");
}

#[test]
fn hidden_startup_processes_quit_channel_without_rendering() {
    let mut desktop = DesktopFixture::new();
    assert!(!desktop.visible());
    desktop
        .quit
        .try_send(())
        .unwrap_or_else(|error| panic!("{error}"));
    desktop.harness.settle(16);
    assert!(
        desktop.harness.platform().is_exiting(),
        "hidden quit wake was lost"
    );
    assert!(
        !desktop.visible(),
        "quitting a hidden app displayed a frame"
    );
}
