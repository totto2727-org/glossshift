set shell := ["bash", "-euo", "pipefail", "-c"]

default:
    @just --list generate

# Regenerate original app and tray assets with macOS build-time tools only.
icons:
    swift scripts/generate-icons.swift
