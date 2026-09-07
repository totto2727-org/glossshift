# Desktop integration

## Menu bar and application icons

GlossShift keeps a monochrome template icon in the macOS menu bar while it runs.
Click it and choose **Quit GlossShift** to stop the application and release its global shortcuts.
Closing the translation popup only hides it and keeps the menu bar icon and shortcuts available.

The packaged `GlossShift.app` includes its own application icon for Finder, the Dock, and application switchers.
Both `just package-app` and the Nix package install the icon inside the application bundle.
Running a bare development executable does not provide Finder with an application bundle icon.

The status item is created on GPUI's main event-loop thread and retained until application shutdown, as required by [tray-icon's macOS integration contract](https://docs.rs/tray-icon/0.24.2/tray_icon/#platform-specific-notes).

## Launch at login

Automatic startup is opt-in and applies to the current user's next graphical login, not to system boot before a user signs in.
Install the application in a stable location first, then run:

```bash
glossshift autostart enable --app "$HOME/.nix-profile/Applications/GlossShift.app"
glossshift autostart status
```

For a conventional installation, pass `/Applications/GlossShift.app` instead.
The path must be absolute and point to a GlossShift application bundle.
The supplied path is preserved rather than resolved into a version-specific Nix store path, so a stable profile link can follow upgrades.
Do not register a temporary build directory or a version-specific `/nix/store` path unless you intend to keep that exact installation available.

Disable future login startup with:

```bash
glossshift autostart disable
```

Enabling writes `~/Library/LaunchAgents/com.totto2727.glossshift.plist` atomically with mode `0600`.
The job uses `RunAtLoad` in an `Aqua` session to open the bundle with `--background` and does not use `KeepAlive`.
Registration does not launch another app now, and disabling does not quit an app that is already running.
Choose **Quit GlossShift** from the menu bar to stop the current app.
Re-enable after moving the bundle or changing the configuration location.

If `XDG_CONFIG_HOME` is set while enabling, its absolute path is saved in the job's environment so login startup selects the same configuration.
Other environment variables, API keys, and credentials are not copied into the job.
Without `XDG_CONFIG_HOME`, the normal `~/.config/glossshift` location is used.

`status` reports the configured next-login job, not whether macOS has allowed it or whether an app is currently running.
System Settings > General > Login Items and device-management policies can affect execution.
Malformed jobs, unrelated files, or symlinks at GlossShift's job path are reported instead of overwritten or removed.
Help and autostart commands do not load translation configuration, create credential files, register global shortcuts, or start the GUI.
Failures produce a nonzero exit status.

To start hidden without registering a login job:

```bash
glossshift --background
```

The menu bar and global shortcuts remain available, but the popup is neither shown nor focused at startup.
A translation shortcut reveals it normally.

### macOS references

- [Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [Apple: Manage login items and background tasks](https://support.apple.com/guide/deployment/manage-login-items-and-background-tasks-depdca572563/web)

The implementation uses user LaunchAgents for compatibility with the application's macOS 12 minimum rather than the macOS 13-only `SMAppService` API.
