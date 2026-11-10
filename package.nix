{
  lib,
  stdenv,
  rustPlatform,
  buildEnv,
  cargo,
  rustc,
  nsh,
  nodejs_26,
  pnpm,
  pnpmConfigHook,
  jq,
  rcodesign,
  writeShellScriptBin,
  glossshift-source,
  glossshift-pnpm-deps,
}:

let
  # NSH expects Apple's bundle-signing CLI. sigtool only signs Mach-O files.
  # Accept only the exact offline ad-hoc invocation used by the pinned packager.
  bundleSigner = writeShellScriptBin "codesign" ''
    if [ "$#" -ne 5 ] || [ "$1" != --force ] || [ "$2" != --sign ] ||
       [ "$3" != - ] || [ "$4" != --timestamp=none ]; then
      printf '%s\n' 'Unsupported codesign invocation: only offline ad-hoc bundle signing is supported.' >&2
      exit 1
    fi
    exec ${rcodesign}/bin/rcodesign sign "$5"
  '';
in
stdenv.mkDerivation {
  pname = "glossshift";
  version = "0.2.0";
  src = glossshift-source;
  pnpmDeps = glossshift-pnpm-deps;
  cargoDeps = buildEnv {
    name = "cargo-vendor-dir";
    paths = [
      # cargoSetupHook validates cargoRoot against this lock, not the batch CLI lock.
      (lib.hiPrio (rustPlatform.importCargoLock { lockFile = ./nix/nsh-host-Cargo.lock; }))
      (rustPlatform.importCargoLock { lockFile = ./nix/nsh-tui-Cargo.lock; })
      (rustPlatform.importCargoLock { lockFile = ./native/Cargo.lock; })
    ];
    pathsToLink = [ "/" ];
    ignoreCollisions = true;
  };
  cargoRoot = ".nsh/rust";
  nativeBuildInputs = [
    cargo
    rustc
    rustPlatform.cargoSetupHook
    nsh
    nodejs_26
    pnpm
    pnpmConfigHook
    jq
    rcodesign
  ];
  CARGO_NET_OFFLINE = "true";
  prePatch = ''
    mkdir -p .nsh/rust/tui
    cp nix/nsh-host-Cargo.lock .nsh/rust/Cargo.lock
    cp nix/nsh-tui-Cargo.lock .nsh/rust/tui/Cargo.lock
  '';
  buildPhase = ''
    runHook preBuild
    export PATH="${bundleSigner}/bin:$PATH"
    # Reuse the checked-in ICNS instead of invoking host-only sips/iconutil.
    jq 'del(.icon)' nsh.json > nsh.json.new
    mv nsh.json.new nsh.json
    export CARGO_TARGET_DIR="$PWD/target"
    nsh test Tui.test.ts --target tui
    nsh build . --release
    cargo build --manifest-path native/Cargo.toml --release --bin gshift
    cargo build --manifest-path .nsh/rust/tui/Cargo.toml --release --bin nsh-app-glossshift-tui-host --locked
    nsh package . --target macos
    app=.nsh/out/GlossShift.app
    cp packaging/GlossShift.icns "$app/Contents/Resources/GlossShift.icns"
    substituteInPlace "$app/Contents/Info.plist" \
      --replace-fail '<key>CFBundleName</key>' \
      '<key>CFBundleIconFile</key><string>GlossShift.icns</string><key>CFBundleName</key>'
    rcodesign sign "$app"
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/Applications" "$out/bin" "$out/libexec/glossshift" "$out/share/glossshift/tui"
    cp -R .nsh/out/GlossShift.app "$out/Applications/GlossShift.app"
    ln -s "$out/Applications/GlossShift.app/Contents/MacOS/GlossShift" "$out/bin/glossshift"
    cp target/release/gshift "$out/libexec/glossshift/gshift-batch"
    cp target/release/nsh-app-glossshift-tui-host "$out/libexec/glossshift/gshift-tui-host"
    for item in .nsh/out/bundle.* .nsh/out/app.json .nsh/out/capabilities.json .nsh/out/assets; do
      if [ -e "$item" ]; then cp -R "$item" "$out/share/glossshift/tui/"; fi
    done
    # The TUI host only accepts external JS. Bytecode is restricted to its own
    # app resources or signed .nshpkg files, not this share directory.
    cat > "$out/bin/gshift" <<'EOF'
    #!${stdenv.shell}
    if [ "$#" -eq 0 ] || [ "$1" = "--tui" ]; then
      [ "$#" -eq 0 ] || shift
      exec @out@/libexec/glossshift/gshift-tui-host --bundle @out@/share/glossshift/tui/bundle.js "$@"
    else
      exec @out@/libexec/glossshift/gshift-batch "$@"
    fi
    EOF
    substituteInPlace "$out/bin/gshift" --replace-fail @out@ "$out"
    chmod +x "$out/bin/gshift"
    runHook postInstall
  '';
  # Preserve the packaged runner's signature and embedded resource layout.
  dontFixup = true;
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    test -x "$out/bin/glossshift"
    test -x "$out/bin/gshift"
    test -s "$out/share/glossshift/tui/bundle.js"
    test -s "$out/Applications/GlossShift.app/Contents/Resources/nsh/bundle.nshc"
    "$out/bin/gshift" --help > /dev/null
    runHook postInstallCheck
  '';
  meta = {
    description = "Native macOS streaming translation popup and Markdown CLI";
    license = lib.licenses.mit;
    mainProgram = "glossshift";
    platforms = [ "aarch64-darwin" ];
  };
}
