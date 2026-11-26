# Desktop integration

## Menu bar and application icons

GlossShift keeps a monochrome template icon in the macOS menu bar while it runs.
Click it and choose **Quit GlossShift** to stop the application and release its global shortcuts.
Closing the translation popup only hides it and keeps the menu bar icon and shortcuts available.

The packaged `GlossShift.app` includes its own application icon for Finder, the Dock, and application switchers.
Both `just package-app` and the Nix package install the icon inside the application bundle.
Running a bare development executable does not provide Finder with an application bundle icon.

The menu bar item is installed through NSH's standard `Tray` API in `app/desktop/src/desktop-controls.ts` and retained for the connection scope.
NSH owns the native AppKit event loop, and delayed cleanup from an old scope cannot remove a replacement scope's tray.

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

## Contributor reference: native dependencies

Apple Silicon macOS is the only supported platform.
`app/desktop/src/ports.ts` defines injectable desktop services, and `app/desktop/src/native-adapter.ts` composes them with scoped Effect resources.
`app/desktop/src/selection-client.ts` launches the separate one-shot Swift helper in `helper/` and validates its bounded JSON response.
The helper uses Apple's ApplicationServices Accessibility APIs, captures selection before the popup receives focus, and never simulates `Cmd+C` or modifies the clipboard.
Applications without an accessible selected-text value report a stable public failure.

`app/desktop/src/desktop-controls.ts` uses the standard NSH clipboard, window, application, and tray APIs.
`app/desktop/src/domain.ts` owns pure popup transitions, and `app/desktop/src/controller.ts` owns request replacement, cancellation, and bounded event processing.
The view uses official NSH components and native Tailwind `class` support without an application stylesheet or browser renderer.
The application-lifetime Effect runtime is released on teardown rather than recreated per render.

Menu bar installation and global shortcuts remain desktop adapters, separate from shared translation policy in `package/runtime/src`.
Settings and LaunchAgent operations live in `package/runtime/src/desktop-config.ts` and `package/runtime/src/autostart.ts`.
The `glossshift` launcher delegates autostart operations to the standalone native CLI without starting NSH.
The reusable NSH Effect Platform lives in `package/nsh-platform`, while application environment interpretation stays in `app/desktop/runtime/platform.ts`.
A future platform can supply different adapters without changing translation policy.
There is no Linux implementation or runtime platform switch.

### Markdown and plain text

The Plain toggle in `app/desktop/src/ui.tsx` switches both panes without changing stored source, translation, or copied content.
Markdown uses NSH's standard `TextView`, with literal HTML, disabled math, non-opening links, alt-only images, and plain code blocks without syntax highlighting.
NSH `Scroll` supplies native scrolling rather than browser overflow behavior.
Copy always uses the raw domain text, including Markdown syntax.
There is no custom Markdown parser or browser renderer.

### GUI and boundary tests

Run `vp run test` from the repository root to exercise `app/desktop/app.test.ts` through the official NSH test host.
`vp run test-settings` checks isolated desktop configuration, and `vp run test-platform` exercises the reusable `package/nsh-platform` boundary.
Native CLI logic suites live in `app/cli/src` and run through Vite+ and Vitest, not the GUI host.
Tests use isolated settings, synthetic source text, injected selection results, and boundary adapters rather than private developer configuration.
`vp run ci` is the minimal formatting and lint gate, not an aggregate behavior-test command.
Tests that directly start application, inference, external-tool, or helper binaries are deferred to Projektor issue `GLOSSSHIFT-1`.
The retained logic tests do not establish native Accessibility capture, menu bar appearance, or global shortcut interaction.
Stop native interaction checks if required macOS permissions are unavailable.
