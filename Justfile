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

build:
    vp run build

test:
    vp run test

package-app:
    vp run package

cli *args:
    vp run cli -- {{args}}

# Asset generation remains a macOS development operation.
generate-icons:
    mkdir -p tmp/icons
    swiftc -module-cache-path "$PWD/tmp/icons/module-cache" scripts/generateIcons.swift -o tmp/icons/generate-icons
    tmp/icons/generate-icons
