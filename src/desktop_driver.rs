//! Native desktop loop integration, including a hidden first-frame startup gate.

use std::{cell::Cell, rc::Rc};

use async_channel::Sender;
use zgui::platform::{AppHandler, IdlePolicy, PlatformCx, SurfaceEvent, SurfaceId, WakeReason};

use crate::tray::MenuBarIcon;

pub struct DesktopDriver {
    inner: Box<dyn AppHandler>,
    visible: Rc<Cell<bool>>,
    quit: Option<Sender<()>>,
    tray: Option<MenuBarIcon>,
}

impl DesktopDriver {
    pub fn new(inner: Box<dyn AppHandler>, visible: Rc<Cell<bool>>, quit: Sender<()>) -> Self {
        Self {
            inner,
            visible,
            quit: Some(quit),
            tray: None,
        }
    }

    #[cfg(test)]
    pub fn headless(inner: Box<dyn AppHandler>, visible: Rc<Cell<bool>>) -> Self {
        Self {
            inner,
            visible,
            quit: None,
            tray: None,
        }
    }

    fn flush_hidden(cx: &dyn PlatformCx) {
        if zgui::reactive::flush().needs_another_frame {
            for surface in cx.surfaces() {
                surface.request_redraw();
            }
        }
    }
}

impl AppHandler for DesktopDriver {
    fn surfaces_available(&mut self, cx: &dyn PlatformCx) {
        if self.tray.is_none()
            && let Some(quit) = &self.quit
        {
            match crate::tray::install(quit.clone()) {
                Ok(tray) => self.tray = Some(tray),
                Err(error) => {
                    eprintln!("failed to create menu bar icon: {error:#}");
                    cx.request_exit();
                    return;
                }
            }
        }
        self.inner.surfaces_available(cx);
    }

    fn surfaces_lost(&mut self, cx: &dyn PlatformCx) {
        self.inner.surfaces_lost(cx);
    }

    fn surface_event(&mut self, cx: &dyn PlatformCx, surface: SurfaceId, event: SurfaceEvent) {
        if !self.visible.get() && matches!(event, SurfaceEvent::RedrawRequested) {
            // zgui 0.1 shows every window after its first rendered frame. Flush
            // receiver tasks without rendering until selection has been captured.
            Self::flush_hidden(cx);
            if !self.visible.get() {
                return;
            }
        }
        self.inner.surface_event(cx, surface, event);
    }

    fn wake(&mut self, cx: &dyn PlatformCx, reason: WakeReason) {
        let was_hidden = !self.visible.get();
        if was_hidden {
            // The suppressed initial redraw leaves zgui's window awaiting that
            // frame. Poll receiver tasks here, since its next request_frame may
            // coalesce away the redraw that would otherwise poll them.
            Self::flush_hidden(cx);
        }
        self.inner.wake(cx, reason);
        if was_hidden && self.visible.get() {
            // Bypass the still-pending runtime request when capture/reopen has
            // released the first frame. Subsequent frames use zgui normally.
            for surface in cx.surfaces() {
                surface.request_redraw();
            }
        }
    }

    fn idle(&mut self, cx: &dyn PlatformCx) -> IdlePolicy {
        if self.visible.get() {
            self.inner.idle(cx)
        } else {
            // Background startup has no rendered animation/timer obligations.
            // Async channel and Tokio timer wakes still enter through `wake`.
            IdlePolicy::Block
        }
    }

    fn deadline_reached(&mut self, cx: &dyn PlatformCx) {
        self.inner.deadline_reached(cx);
    }

    fn shutting_down(&mut self, cx: &dyn PlatformCx) {
        self.inner.shutting_down(cx);
    }
}
