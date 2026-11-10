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
            zgui::reactive::flush();
            if !self.visible.get() {
                return;
            }
        }
        self.inner.surface_event(cx, surface, event);
    }

    fn wake(&mut self, cx: &dyn PlatformCx, reason: WakeReason) {
        self.inner.wake(cx, reason);
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
