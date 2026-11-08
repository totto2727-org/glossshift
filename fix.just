set shell := ["bash", "-euo", "pipefail", "-c"]

# Apply all automatic fixes.
[default]
all: rustfmt clippy

# Format Rust source files.
rustfmt:
    cargo fmt --all

# Apply automatic Clippy fixes.
clippy:
    cargo clippy --fix --allow-dirty --allow-staged --all-targets --all-features -- -D warnings
