# Dependency compatibility

This document is for contributors who update the packaged runtime or patched dependencies.
GlossShift is an original application, not a fork of NSH or llama.cpp.
This document records dependency pins, compatibility adapters, and retained dependency patches, not differences from an application upstream.

## NSH release pin

GlossShift uses the official NSH 0.5.0 release at [`longbridge/nsh` revision `f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1`](https://github.com/longbridge/nsh/tree/f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1).
`nix/nsh.nix` pins the official CLI distribution, matching terminal component, and TypeScript compiler with content hashes.
The downloaded NSH distribution and upstream runtime source are unchanged.
The official packager extracts the requested arm64 host from that distribution.
GlossShift supplies Nix's real `lipo` tool and an offline ad-hoc signing adapter, then adds an application launcher and icon before signing the completed app bundle.
These are packaging customizations, not runtime source patches.
The desktop application manifest omits a custom Rust module, so GUI packaging uses the official prebuilt macOS host.
The standalone `gshift` CLI does not use NSH or its terminal component.

The application uses standard NSH window attributes, clipboard, tray, and shortcut APIs.
Accessibility selection capture runs in the separate Swift helper described in [Runtime architecture](./runtime-architecture.md).
There is no retained NSH lifecycle patch or application Cargo build.
When updating NSH, keep its release components on the same exact revision and verify desktop launch, GUI tests, and native packaging.
NSH terminal-host use for isolated compatibility tests is not a shipped interactive CLI product.

## NSH Platform compatibility adapters

The application provides its own Effect Platform services over the standard NSH API without patching that runtime.
NSH 0.5.0 lacks large-file streaming handles, exclusive temporary-file primitives, and parent CLI arguments and standard handles.
Packaged curl and coreutils supply bounded download, hashing, and atomic-file operations.
The independent Node.js 26 CLI uses native arguments, standard streams, working directory, and exit status instead of a shell/headless-host bridge.
The extraction-ready GUI Platform library remains in `package/nsh-platform/platform.ts` and `package/nsh-platform/platform/`, without application-specific environment interpretation or `index.ts` modules.
These adapters are application and packaging code, not upstream runtime changes.
Retest the exact missing APIs on NSH updates and remove a fallback when the official API can safely replace it.
[Runtime architecture](./runtime-architecture.md) records the observed limits and operational impact.

## Inference runtime

The `nixpkgs-llama` input pins [Nixpkgs unstable revision `d4f25a3e562008648d45bcf2d70bcc7422cad84e`](https://github.com/NixOS/nixpkgs/tree/d4f25a3e562008648d45bcf2d70bcc7422cad84e) separately from the main toolchain input.
The unmodified [`llama-cpp` 0.9.0 package](https://github.com/NixOS/nixpkgs/blob/d4f25a3e562008648d45bcf2d70bcc7422cad84e/pkgs/by-name/ll/llama-cpp/package.nix) uses llama.cpp revision [`cd959bae99ff4bed22bef2604f45241c09bbb8c8`](https://github.com/ggml-org/llama.cpp/tree/cd959bae99ff4bed22bef2604f45241c09bbb8c8), build 12110.
The macOS arm64 derivation enables Metal and has a signed substitute in the official Nix binary cache.
GlossShift does not override or patch that derivation, use a custom FFI binding, or compile the engine during an application-only rebuild.
When updating the pin, verify substitute availability and actual model inference before adopting it.
CPU-side buffers still participate, so this does not mean CPU use is eliminated.
Its TypeScript adapter owns authenticated loopback access and process cleanup.
Known model artifacts retain their full per-model context defaults by digest, including when loaded through a `file:` URI.
An unknown custom GGUF digest requires explicit `contextSize` rather than inheriting the default PLaMo context.
Tests that directly start the inference server are deferred to Projektor issue `GLOSSSHIFT-1`, not part of the maintained logic suite.

## Native CLI packaging

`nix/gshift.nix` packages Node.js 26, the production `app/cli` and `package/runtime` trees, and production JavaScript dependencies independently of NSH and Swift.
Command definitions use Effect 4 CLI in `app/cli/src/commands/translate.ts`, with the Node entry in `app/cli/src/main.ts` and dispatch in `app/cli/src/program.ts`.
The combined `glossshift` package links that standalone CLI and therefore includes Node in its closure, although the GUI process remains NSH-only with a separate Swift helper.
The old shell capture bridge and interactive terminal product are removed rather than retained as compatibility dependencies.
Native CLI logic tests in `app/cli/src` run through Vite+ and Vitest with injected services and temporary filesystem data, without starting external binaries.
The PNPM monorepo uses role-based `app/*` and `package/*` projects with `workspace:*` dependencies and catalog-managed external versions, without changing dependency pins or release-age policy.
Shared source exports replace cross-project relative imports and do not require TypeScript path aliases.
Common strict compiler policy lives in `tsconfig.base.json`, while minimal project profiles retain separate Node and generated NSH ambient environments.
The common base supplies one whole-project `include: ["${configDir}/**/*"]` rule, while project profiles add no file lists or exclusions.
This restores complete source and test discovery despite NSH's generated `files` roots, which otherwise suppress TypeScript's implicit discovery.
Recursive workspace scripts own typechecking rather than the root lint gate.
See [Workspace and TypeScript ownership](./runtime-architecture.md#workspace-and-typescript-ownership) for the observed ambient declaration conflicts that prevent one combined type program.
GUI behavior tests remain in the official NSH test host with injected native boundaries.
All tests, test-only helpers, and fixtures are excluded from distribution sources, and Nix package derivations run no checks or tests.
Build-artifact, signature, and package-closure checks are not maintained as tests.
Direct-binary integration work is tracked in Projektor issue `GLOSSSHIFT-1`.

## plist dictionary validation

The npm dependency [`plist` 5.1.1](https://www.npmjs.com/package/plist/v/5.1.1) has a compatibility patch at `patches/plist@5.1.1.patch`.
The lockfile pins the published archive by its integrity digest and records the patch hash.
This is a parser patch, not a change to NSH or the inference runtime.

The upstream XML and binary dictionary parsers replace an earlier value when the same key appears again.
GlossShift must reject ambiguous LaunchAgent registrations before deciding that it owns a file and can replace or remove it.
The patch adds duplicate-key rejection to `dist/parse.js` and `dist/parse-binary.js` without changing serialization or valid plist handling.
NSH 0.5.0 selects the package's browser export, but its official QuickJS host does not provide the global `DOMParser` required by `dist/parse.browser.js`.
The patch therefore routes only the browser entry's `parse` export to the existing `dist/parse.js`, which uses the package's declared `@xmldom/xmldom` dependency and retains the same duplicate-key protection.
This is an explicit package compatibility patch, not a requirement to start Node from the GUI or a custom XML parser.
Duplicate-key rejection protects registration ownership checks from ambiguous dictionary values.
Review this patch when updating `plist` and remove it if upstream rejects duplicate dictionary keys.
