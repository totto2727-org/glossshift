set shell := ["bash", "-euo", "pipefail", "-c"]

import 'bundle.just'

mod fix 'fix.just'
mod check 'check.just'
mod package 'package.just'
mod generate 'generate.just'

alias build := package::_build

default:
    @just --list --list-submodules

# Run the application directly with Cargo.
dev:
    cargo run --bin glossshift

# Run the CLI with arguments, for example: just cli README.md --lang ja.
cli *args:
    cargo run --bin gshift -- {{ args }}

# Run unit tests.
test:
    cargo test

# Run every local validation gate.
ci: check::all test package::_build

run: package::app
    open '{{ bundle }}'
