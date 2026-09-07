set shell := ["bash", "-euo", "pipefail", "-c"]

bundle := "target/GlossShift.app"

default:
    @just --list

# Run the application directly with Cargo.
dev:
    cargo run --bin glossshift

# Run the CLI with arguments, for example: just cli README.md --lang ja.
cli *args:
    cargo run --bin gshift -- {{args}}

# Apply all automatic fixes.
fix: fix-rustfmt fix-clippy

# Format Rust source files.
fix-rustfmt:
    cargo fmt --all

# Apply automatic Clippy fixes.
fix-clippy:
    cargo clippy --fix --allow-dirty --allow-staged --all-targets --all-features -- -D warnings

# Run all static checks.
check: check-rustfmt check-clippy

# Check Rust source formatting without changing files.
check-rustfmt:
    cargo fmt --all --check

# Run strict Clippy checks for every target and feature.
check-clippy:
    cargo clippy --all-targets --all-features -- -D warnings

# Run unit tests.
test:
    cargo test

# Build the debug binary.
build:
    cargo build

# Run every local validation gate.
ci: check test build

# Build a local macOS application bundle with a stable identity.
package-app: build
    mkdir -p "{{ bundle }}/Contents/MacOS" "{{ bundle }}/Contents/Resources"
    cp target/debug/glossshift "{{ bundle }}/Contents/MacOS/glossshift"
    cp packaging/Info.plist "{{ bundle }}/Contents/Info.plist"
    cp packaging/GlossShift.icns "{{ bundle }}/Contents/Resources/GlossShift.icns"
    codesign --force --deep --sign - "{{ bundle }}"
    codesign --verify --deep --strict "{{ bundle }}"
    @printf '%s\n' "{{ bundle }}"

# Regenerate original app and tray assets with macOS build-time tools only.
generate-icons:
    swift scripts/generate-icons.swift

# Verify ICNS representations, preview dimensions, and the raw tray template contract.
check-icons:
    swift scripts/validate-icons.swift

run: package-app
  open '{{bundle}}'
