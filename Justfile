set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list

# Preserve the existing workflow entrypoint without changing CI workflows.
ci:
    vp install --frozen-lockfile
    vp run ci

check:
    vp run check

fix:
    vp run fix

typecheck:
    vp run typecheck

dev:
    vp run dev

run:
    vp run run

tui:
    vp run tui

build:
    vp run build

test:
    vp run test

test-tui:
    vp run test-tui

package-app:
    vp run package

cli *args:
    vp run cli -- {{args}}

# Asset generation remains a macOS development operation.
generate-icons:
    swift scripts/generate-icons.swift

check-icons:
    swift scripts/validate-icons.swift
