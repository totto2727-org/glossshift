{
  lib,
  mainProgram ? "translate-popup",
  rustPlatform,
}:

rustPlatform.buildRustPackage {
  pname = "translate-popup";
  version = "0.1.0";

  src = lib.cleanSource ./.;
  cargoLock.lockFile = ./Cargo.lock;

  postInstall = ''
    test -x "$out/bin/translate-popup"
    test -x "$out/bin/translate-popup-cli"
    app="$out/Applications/Translate Popup.app/Contents"
    mkdir -p "$app/MacOS"
    cp packaging/Info.plist "$app/Info.plist"
    ln -s "$out/bin/translate-popup" "$app/MacOS/translate-popup"
  '';

  meta = {
    description = "A macOS GPUI popup and CLI for streaming translations through Rig";
    license = lib.licenses.mit;
    inherit mainProgram;
    platforms = lib.platforms.darwin;
  };
}
