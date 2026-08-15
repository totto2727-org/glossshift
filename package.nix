{
  lib,
  rustPlatform,
}:

rustPlatform.buildRustPackage {
  pname = "translate-popup";
  version = "0.1.0";

  src = lib.cleanSource ./.;
  cargoLock.lockFile = ./Cargo.lock;

  postInstall = ''
    app="$out/Applications/Translate Popup.app/Contents"
    mkdir -p "$app/MacOS"
    cp packaging/Info.plist "$app/Info.plist"
    ln -s "$out/bin/translate-popup" "$app/MacOS/translate-popup"
  '';

  meta = {
    description = "A macOS global-shortcut translation popup built with GPUI and Rig";
    license = lib.licenses.mit;
    mainProgram = "translate-popup";
    platforms = lib.platforms.darwin;
  };
}
