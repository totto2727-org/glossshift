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
    mkdir -p .nsh/rust
    cp nix/nsh-host-Cargo.lock .nsh/rust/Cargo.lock
  '';
  buildPhase = ''
    runHook preBuild
    export PATH="${bundleSigner}/bin:$PATH"
    # Reuse the checked-in ICNS instead of invoking host-only sips/iconutil.
    jq --arg node '${nodejs_26}/bin/node' 'del(.icon) | .capabilities.process.execute = [$node]' nsh.json > nsh.json.new
    mv nsh.json.new nsh.json
    jq --arg node '${nodejs_26}/bin/node' '.capabilities.process.execute = [$node]' terminal/nsh.json > terminal/nsh.json.new
    mv terminal/nsh.json.new terminal/nsh.json
    export CARGO_TARGET_DIR="$PWD/target"
    nsh build . --release
    nsh build terminal --release --out terminal/.nsh/out
    test ! -e terminal/.nsh/rust
    if grep -q 'glossshift/native' terminal/.nsh/out/bundle.js; then
      printf '%s\n' 'Terminal bundle must not import the desktop native module.' >&2
      exit 1
    fi
    node --input-type=module -e '
      const { getLlama } = await import("node-llama-cpp");
      const llama = await getLlama({ build: "never", skipDownload: true, usePrebuiltBinaries: true, gpu: "metal", dryRun: true });
      await llama.dispose();
    '
    nsh package . --target macos
    app=.nsh/out/GlossShift.app
    cp packaging/GlossShift.icns "$app/Contents/Resources/GlossShift.icns"
    substituteInPlace "$app/Contents/Info.plist" \
      --replace-fail '<key>CFBundleName</key>' \
      '<key>CFBundleIconFile</key><string>GlossShift.icns</string><key>CFBundleName</key>'
    mkdir -p "$app/Contents/Resources/glossshift"
    jq -n --arg command '${nodejs_26}/bin/node' \
      --arg entry "$out/libexec/glossshift/node/main.ts" \
      '{command: $command, entry: $entry}' > runtime.json
    cp runtime.json "$app/Contents/Resources/glossshift/runtime.json"
    rcodesign sign "$app"
    # Build hooks are denied. Pruning keeps all optional native prebuilds for this host.
    CI=true npm_config_offline=true pnpm prune --prod --ignore-scripts
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/Applications" "$out/bin" "$out/libexec/glossshift" "$out/share/glossshift/tui"
    cp -R .nsh/out/GlossShift.app "$out/Applications/GlossShift.app"
    ln -s "$out/Applications/GlossShift.app/Contents/MacOS/GlossShift" "$out/bin/glossshift"
    cp -R node_modules package.json runtime.json "$out/libexec/glossshift/"
    mkdir -p "$out/libexec/glossshift/node" "$out/libexec/glossshift/src"
    for source in node/*.ts; do
      case "$source" in *.test.ts) continue ;; esac
      cp "$source" "$out/libexec/glossshift/node/"
    done
    cp src/local-protocol.ts src/desktop-settings.ts "$out/libexec/glossshift/src/"
    ln -s ${nsh}/libexec/nsh/runtime/tui/nsh-tui-host "$out/libexec/glossshift/gshift-tui-host"
    for item in terminal/.nsh/out/bundle.* terminal/.nsh/out/app.json terminal/.nsh/out/capabilities.json terminal/.nsh/out/assets; do
      if [ -e "$item" ]; then cp -R "$item" "$out/share/glossshift/tui/"; fi
    done
    # The TUI host only accepts external JS. Bytecode is restricted to its own
    # app resources or signed .nshpkg files, not this share directory.
    cat > "$out/bin/gshift" <<'EOF'
    #!${stdenv.shell}
    if [ "$#" -eq 0 ] || [ "$1" = "--tui" ]; then
      [ "$#" -eq 0 ] || shift
      export GLOSSSHIFT_NODE_COMMAND='${nodejs_26}/bin/node'
      export GLOSSSHIFT_NODE_ENTRY='@out@/libexec/glossshift/node/main.ts'
      exec @out@/libexec/glossshift/gshift-tui-host --bundle @out@/share/glossshift/tui/bundle.js "$@"
    else
      exec ${nodejs_26}/bin/node @out@/libexec/glossshift/node/main.ts "$@"
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
    test -x "$out/libexec/glossshift/gshift-tui-host"
    test -s "$out/share/glossshift/tui/bundle.js"
    test -s "$out/Applications/GlossShift.app/Contents/Resources/nsh/bundle.nshc"
    test -s "$out/libexec/glossshift/runtime.json"
    test -s "$out/Applications/GlossShift.app/Contents/Resources/glossshift/runtime.json"
    ${nodejs_26}/bin/node --input-type=module -e '
      const { getLlama } = await import("file://" + process.argv[1] + "/node_modules/node-llama-cpp/dist/index.js");
      const llama = await getLlama({ build: "never", skipDownload: true, usePrebuiltBinaries: true, gpu: "metal", dryRun: true });
      await llama.dispose();
    ' "$out/libexec/glossshift"
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
