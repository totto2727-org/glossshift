{
  lib,
  mainProgram ? "glossshift",
  rustPlatform,
}:

rustPlatform.buildRustPackage {
  pname = "glossshift";
  version = "0.1.0";

  src = lib.cleanSource ./.;
  cargoLock.lockFile = ./Cargo.lock;

  postInstall = ''
    test -x "$out/bin/glossshift"
    test -x "$out/bin/gshift"
    app="$out/Applications/GlossShift.app/Contents"
    mkdir -p "$app/MacOS"
    cp packaging/Info.plist "$app/Info.plist"
    ln -s "$out/bin/glossshift" "$app/MacOS/glossshift"
  '';

  meta = {
    description = "A macOS GPUI popup and CLI for streaming translations through Rig";
    license = lib.licenses.mit;
    inherit mainProgram;
    platforms = lib.platforms.darwin;
  };
}
