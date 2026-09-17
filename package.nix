{
  lib,
  mainProgram ? "glossshift",
  rustPlatform,
}:

rustPlatform.buildRustPackage {
  pname = "glossshift";
  version = "0.2.0";

  src = lib.cleanSource ./.;
  cargoLock = {
    lockFile = ./Cargo.lock;
    outputHashes."llm-profiles-0.1.0" = "1rarzkrppbka3k2ardmd64x61k36xhaggcxcnxhischbchaivxpx";
  };

  postInstall = ''
    test -x "$out/bin/glossshift"
    test -x "$out/bin/gshift"
    app="$out/Applications/GlossShift.app/Contents"
    mkdir -p "$app/MacOS" "$app/Resources"
    cp packaging/Info.plist "$app/Info.plist"
    cp packaging/GlossShift.icns "$app/Resources/GlossShift.icns"
    ln -s "$out/bin/glossshift" "$app/MacOS/glossshift"
  '';

  meta = {
    description = "A macOS GPUI popup and CLI for streaming translations through Rig";
    license = lib.licenses.mit;
    inherit mainProgram;
    platforms = lib.platforms.darwin;
  };
}
