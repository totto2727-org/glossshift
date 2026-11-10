//! macOS event-loop configuration for visible and background startup.

use winit::{event_loop::EventLoop, platform::macos::EventLoopBuilderExtMacOS as _};
use zgui::platform::{AppHandler, PlatformError};
use zgui_platform_winit::{UserEvent, WinitApp};

pub fn run(handler: Box<dyn AppHandler>, background: bool) -> Result<(), PlatformError> {
    let mut builder = EventLoop::<UserEvent>::with_user_event();
    // zgui's default desktop driver always activates macOS at launch. Configure
    // the same public backend explicitly so --background does not steal focus.
    builder.with_activate_ignoring_other_apps(!background);
    let event_loop = builder.build().map_err(backend_error)?;
    let mut app = WinitApp::new(&event_loop, handler);
    event_loop.run_app(&mut app).map_err(backend_error)
}

fn backend_error(error: impl std::fmt::Display) -> PlatformError {
    PlatformError::Backend(error.to_string())
}
