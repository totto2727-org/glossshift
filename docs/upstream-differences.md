# NSH upstream differences

## Comparison revision

GlossShift uses the NSH nightly distribution at [`longbridge/nsh` revision `c5214aaf4bbdf33bc1d59e9595e009b6aa54d702`](https://github.com/longbridge/nsh/tree/c5214aaf4bbdf33bc1d59e9595e009b6aa54d702).
The development environment pins the source archive, official nightly CLI distribution, and official terminal component to the same revision, with separate content hashes.
The nightly channel does not select the Rust nightly toolchain.
The CLI remains unchanged.
`patches/nsh-macos-lifecycle.patch` is applied to that exact source before NSH generates and builds the application's native hosts.

## Retained operational difference

By default, the standard macOS host shows and activates its initial window.
Its public activation policy, window attributes, and `keep_alive_on_close` option already support accessory applications, minimum sizes, and retaining a closed window, but the generated JavaScript application runner does not expose an application setup hook that can initialize native services before activation.
The upstream `background` option still shows a non-activating window, so it does not replace hidden startup.
GlossShift requires non-activating `--background` startup, capture before activation, native shortcut and tray lifetimes, configured window bounds, and close-to-hide behavior.
Showing the window and hiding it later does not meet the startup requirement.

The patch changes only `crates/nsh-platform-macos/src/app.rs` and that crate's public re-exports in `src/lib.rs`.
It adds:

- An optional pair of main-thread setup and shutdown functions for standalone applications.
- An `initially_hidden` option that suppresses initial showing and activation without suppressing engine startup.
- An optional minimum content size.
- Thread-safe show and hide requests for the retained standalone window.

Hook registration stores function pointers only.
It does not read configuration, register shortcuts, create a tray, or request permissions while NSH describes exports or constructs a headless test host.
The setup function runs when the standalone runner starts, before it constructs or activates its window.
Shutdown runs after engine cleanup, including setup failure and successful early exit.
Unconfigured hosts retain the upstream defaults, including notification setup, URL launch delivery, activation policy, window attributes, and the original event loop.
The terminal host is unchanged and does not invoke the macOS hooks.

The explicit show request uses AppKit's public `activateIgnoringOtherApps(true)` method because cooperative `activate()` does not guarantee activation unless the foreground application yields it.
A global translation shortcut cannot require changes to another application, and showing an inactive popup does not meet the focus requirement.
This deprecated API is allowed only at that call site, not for background startup, and must be revisited when upgrading the macOS host.
It does not grant Accessibility permission or change system privacy settings.

## Operational impact

GlossShift keeps NSH's AppKit event loop and delegate rather than adding a second GUI loop or an application-owned unsafe AppKit delegate.
Application Rust code continues to forbid unsafe code.
Provider resolution, credentials, and translation protocol behavior are not changed by this patch.
The standard NSH typecheck, development, test, build, and package commands remain the entry points.

The pinned, patched source is made available at the reproducible development dependency path `.nsh/upstream`.
This generated path is not committed and is not an arbitrary sibling checkout or a benchmark fixture.
The native manifests use it so the official CLI selects the same source for all generated hosts, instead of mixing registry and patched NSH crate identities.
A fresh checkout must prepare the pinned development environment before invoking native NSH tasks.

When upgrading NSH, compare against the exact replacement upstream revision, remove any superseded patch, and update this record and the source pin together.
Prefer an upstream lifecycle API if it provides the same behavior.
