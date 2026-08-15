set shell := ["bash", "-euo", "pipefail", "-c"]

bundle := "target/GlossShift.app"

default: ci

# Run the application directly with Cargo.
dev:
    cargo run --bin glossshift

# Run the CLI with arguments, for example: just cli README.md --lang ja.
cli *args:
    cargo run --bin gshift -- {{args}}

# Apply all automatic fixes.
fix: fix-format fix-lint

# Format Rust source files.
fix-format:
    cargo fmt --all

# Apply automatic Clippy fixes.
fix-lint:
    cargo clippy --fix --allow-dirty --allow-staged --all-targets --all-features -- -D warnings

# Run all static checks.
check: check-format check-lint

# Check Rust source formatting without changing files.
check-format:
    cargo fmt --all --check

# Run strict Clippy checks for every target and feature.
check-lint:
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
    mkdir -p "{{ bundle }}/Contents/MacOS"
    cp target/debug/glossshift "{{ bundle }}/Contents/MacOS/glossshift"
    cp packaging/Info.plist "{{ bundle }}/Contents/Info.plist"
    codesign --force --deep --sign - "{{ bundle }}"
    codesign --verify --deep --strict "{{ bundle }}"
    @printf '%s\n' "{{ bundle }}"

run: package-app
  open '{{bundle}}'
