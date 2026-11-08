set shell := ["bash", "-euo", "pipefail", "-c"]

# Run all static checks.
[default]
all: rustfmt clippy

# Check Rust source formatting without changing files.
rustfmt:
    cargo fmt --all --check

# Run strict Clippy checks for every target and feature.
clippy:
    cargo clippy --all-targets --all-features -- -D warnings

# Verify ICNS representations, preview dimensions, and the raw tray template contract.
icons:
    swift scripts/validate-icons.swift
