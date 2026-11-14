{ lib, stdenv, swift }:

stdenv.mkDerivation {
  pname = "glossshift-macos-helper";
  version = "0.1.0";
  src = lib.cleanSourceWith {
    src = ../helper;
    filter = path: _type: builtins.baseNameOf path != ".build";
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
  doCheck = true;
  checkPhase = ''
    runHook preCheck
    swiftc -module-cache-path "$TMPDIR/swift-module-cache" \
      Selection.swift tests/SelectionTests.swift -o helper-tests
    ./helper-tests
    runHook postCheck
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
