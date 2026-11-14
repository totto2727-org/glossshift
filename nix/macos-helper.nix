{ lib, stdenv, swift }:

stdenv.mkDerivation {
  pname = "glossshift-macos-helper";
  version = "0.1.0";
  src = lib.fileset.toSource {
    root = ../helper;
    fileset = lib.fileset.unions [
      ../helper/Selection.swift
      ../helper/main.swift
    ];
  };
  nativeBuildInputs = [ swift ];
  strictDeps = true;
  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    swiftc -O -module-cache-path "$TMPDIR/swift-module-cache" \
      Selection.swift main.swift -o glossshift-macos-helper
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    install -Dm755 glossshift-macos-helper "$out/bin/glossshift-macos-helper"
    runHook postInstall
  '';
  meta = {
    description = "One-shot nonprompting macOS Accessibility helper for GlossShift";
    platforms = [ "aarch64-darwin" ];
    mainProgram = "glossshift-macos-helper";
  };
}
