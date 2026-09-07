# Desktop integration

## Menu bar and application icons

GlossShift keeps a monochrome template icon in the macOS menu bar while it runs.
Click it and choose **Quit GlossShift** to stop the application and release its global shortcuts.
Closing the translation popup only hides it and keeps the menu bar icon and shortcuts available.

The packaged `GlossShift.app` includes its own application icon for Finder, the Dock, and application switchers.
Both `just package-app` and the Nix package install the icon inside the application bundle.
Running a bare development executable does not provide Finder with an application bundle icon.

The status item is created on GPUI's main event-loop thread and retained until application shutdown, as required by [tray-icon's macOS integration contract](https://docs.rs/tray-icon/0.24.2/tray_icon/#platform-specific-notes).
