# Upstream differences

This document is for contributors who update the packaged runtime or patched dependencies.

## NSH comparison revision

GlossShift uses the official NSH 0.5.0 release at [`longbridge/nsh` revision `f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1`](https://github.com/longbridge/nsh/tree/f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1).
`nix/nsh.nix` pins the official CLI distribution, matching terminal component, and TypeScript compiler with content hashes.
The downloaded NSH distribution and upstream runtime source are unchanged.
The official packager extracts the requested arm64 host from that distribution.
GlossShift supplies Nix's real `lipo` tool and an offline ad-hoc signing adapter, then adds an application launcher and icon before signing the completed app bundle.
These are packaging customizations, not runtime source patches.
Both application manifests omit a custom Rust module, so packaging uses the official prebuilt hosts.

The application uses standard NSH window attributes, clipboard, tray, and shortcut APIs.
Accessibility selection capture runs in the separate Swift helper described in [Runtime architecture](./runtime-architecture.md).
There is no retained NSH lifecycle patch or application Cargo build.
When updating NSH, keep the CLI and terminal component on the same exact release and verify both installed launch modes.

## Inference runtime

`nix/llama-server.nix` pins the official [`ggml-org/llama.cpp` b12110 macOS arm64 release](https://github.com/ggml-org/llama.cpp/releases/tag/b12110) by SHA-256.
It installs the server and its sibling dynamic libraries without changing upstream Mach-O binaries or signatures.
The package includes the upstream license.
GlossShift does not patch the engine, use a custom FFI binding, or compile llama.cpp as part of an application build.
Its TypeScript adapter owns authenticated loopback access and process cleanup.

## plist dictionary validation

The npm dependency [`plist` 5.1.1](https://www.npmjs.com/package/plist/v/5.1.1) has a compatibility patch at `patches/plist@5.1.1.patch`.
The lockfile pins the published archive by its integrity digest and records the patch hash.
This is a parser patch, not a change to NSH or the inference runtime.

The upstream XML and binary dictionary parsers replace an earlier value when the same key appears again.
GlossShift must reject ambiguous LaunchAgent registrations before deciding that it owns a file and can replace or remove it.
The patch adds duplicate-key rejection to `dist/parse.js` and `dist/parse-binary.js` without changing serialization or valid plist handling.
Isolated filesystem regressions cover registrations with duplicate keys and verify that status, enable, and disable leave their bytes unchanged.
Review this patch when updating `plist` and remove it if upstream rejects duplicate dictionary keys.
