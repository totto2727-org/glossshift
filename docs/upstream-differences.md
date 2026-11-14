# NSH upstream differences

## Comparison revision

GlossShift uses the official NSH 0.5.0 release at [`longbridge/nsh` revision `f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1`](https://github.com/longbridge/nsh/tree/f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1).
The development environment pins the source archive, official CLI distribution, and official terminal component to the same release, with separate content hashes.
The CLI remains unchanged.
`patches/nsh-macos-lifecycle.patch` is applied to that exact source before NSH generates and builds the application's native hosts.

## Retained operational difference

Upstream 0.5.0 supports hidden initial startup through `nsh.json` `window.defaultVisible: false`, minimum sizes through window attributes, explicit window focus, and engine-owned cleanup through `on_app_quit`.
Its `background` host option still shows a non-activating window and prohibits application activation, so it is not the application's hidden-startup flag.
The generated JavaScript application runner does not expose a native setup hook before window construction and activation.
GlossShift still needs that hook to parse packaged launch flags, complete help or autostart commands without opening a window, load configured window bounds, and initialize native shortcut services on the main thread.
The application creates its tray and performs ordinary clipboard, window, and quit operations through NSH's standard JavaScript APIs.
Its shutdown guard also runs after setup failure and successful early exit, before an engine or an engine-owned quit listener exists.
Upstream `on_app_quit` is therefore not a replacement for this guard: its listeners belong to a running engine and their futures have a shared 200 ms deadline.

The patch changes only `crates/nsh-platform-macos/src/app.rs` and that crate's public re-exports in `src/lib.rs`.
It retains the existing native integration contract:

- An optional pair of main-thread setup and shutdown functions for standalone applications.
- An `initially_hidden` option for the dynamic packaged `--background` flag, combined with upstream launch visibility rather than replacing it.
- An optional minimum content size from the application's settings, applied after upstream launch attributes.
- Thread-safe show and hide requests for the retained standalone window.

Hook registration stores function pointers only.
It does not read configuration, register shortcuts, create a tray, or request permissions while NSH describes exports or constructs a headless test host.
The setup function runs when the standalone runner starts, before it constructs or activates its window.
Shutdown runs after engine cleanup, including setup failure and successful early exit.
Unconfigured hosts retain the upstream defaults, including notification setup, URL launch delivery, activation policy, window attributes, and the original event loop.
The visibility change preserves upstream development-host window holding, `defaultVisible`, `show_launched`, and `launched_main` bookkeeping.
With no hooks installed, `min_size` remains `None` and `initially_hidden` remains `false`, so the upstream size and visibility paths are unchanged.
The terminal host is unchanged and does not invoke the macOS hooks.

The retained explicit show request uses AppKit's public `activateIgnoringOtherApps(true)` method because cooperative `activate()` does not guarantee activation unless the foreground application yields it.
Upstream 0.5.0 also uses this method for explicit window focus.
Ordinary application controls now use the upstream JavaScript APIs, while capture-before-focus on global shortcut release still uses the native reveal request.
A global translation shortcut cannot require changes to another application, and showing an inactive popup does not meet the focus requirement.
This deprecated API is allowed only at that call site in the patch, not for background startup.
It does not grant Accessibility permission or change system privacy settings.

## Operational impact

GlossShift keeps NSH's AppKit event loop and delegate rather than adding a second GUI loop or an application-owned unsafe AppKit delegate.
Application Rust code continues to forbid unsafe code.
Provider resolution, credentials, and translation protocol behavior are not changed by this patch.
The standard NSH typecheck, development, test, build, and macOS package commands remain the entry points.
Official 0.5.0 includes the terminal host but does not provide a `nsh package --target tui` target.
The installed terminal command uses the unchanged official prebuilt terminal host and a separate Rust-free TypeScript bundle rather than an invented terminal package target.
Its manifest has no custom Rust dependency, and terminal-only build tasks do not generate a Rust workspace.
Desktop packaging still builds the patched native host.

The pinned, patched source is made available at the reproducible development dependency path `.nsh/upstream`.
This generated path is not committed and is not an arbitrary sibling checkout or a benchmark fixture.
The native manifests use it so the official CLI selects the same source for all generated hosts, instead of mixing registry and patched NSH crate identities.
A fresh checkout must prepare the pinned development environment before invoking native NSH tasks.

When upgrading NSH, compare against the exact replacement upstream revision, remove any superseded patch, and update this record and the source pin together.
Prefer an upstream lifecycle API if it provides the same behavior.

## plist dictionary validation

The npm dependency [`plist` 5.1.1](https://www.npmjs.com/package/plist/v/5.1.1) has a separate compatibility patch at `patches/plist@5.1.1.patch`.
The lockfile pins the published archive by its integrity digest and records the patch hash.
This patch is not part of the NSH source patch.

The upstream XML and binary dictionary parsers replace an earlier value when the same key appears again.
GlossShift must reject ambiguous LaunchAgent registrations before deciding that it owns a file and may replace or remove it.
The patch adds duplicate-key rejection to `dist/parse.js` and `dist/parse-binary.js` without changing serialization or valid plist handling.
Isolated filesystem regressions cover XML and binary registrations with duplicate keys and verify that status, enable, and disable leave their bytes unchanged.
Review this patch when updating `plist` and remove it if upstream rejects duplicate dictionary keys.
