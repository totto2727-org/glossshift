set shell := ["bash", "-euo", "pipefail", "-c"]

import 'bundle.just'

default:
    @just --list package

# Build the debug binary.
_build:
    cargo build

# Build a local macOS application bundle with a stable identity.
app: _build
    mkdir -p "{{ bundle }}/Contents/MacOS" "{{ bundle }}/Contents/Resources"
    cp target/debug/glossshift "{{ bundle }}/Contents/MacOS/glossshift"
    cp packaging/Info.plist "{{ bundle }}/Contents/Info.plist"
    cp packaging/GlossShift.icns "{{ bundle }}/Contents/Resources/GlossShift.icns"
    codesign --force --deep --sign - "{{ bundle }}"
    codesign --verify --deep --strict "{{ bundle }}"
    @printf '%s\n' "{{ bundle }}"
