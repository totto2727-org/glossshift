{
  lib,
  stdenvNoCC,
  darwin,
  nsh,
  nodejs_26,
  pnpm,
  pnpmConfigHook,
  jq,
  rcodesign,
  writeShellScriptBin,
  makeBinaryWrapper,
  glossshift-source,
  glossshift-pnpm-deps,
  glossshift-llama-server,
  glossshift-macos-helper,
}:

let
  nodeCommand = "${nodejs_26}/bin/node";
  serverCommand = "${glossshift-llama-server}/bin/llama-server";
  helperCommand = "${glossshift-macos-helper}/bin/glossshift-macos-helper";
  # Match only the pinned packager's offline ad-hoc signing invocation.
  bundleSigner = writeShellScriptBin "codesign" ''
    if [ "$#" -ne 5 ] || [ "$1" != --force ] || [ "$2" != --sign ] ||
       [ "$3" != - ] || [ "$4" != --timestamp=none ]; then
      printf '%s\n' 'Unsupported codesign invocation: only offline ad-hoc bundle signing is supported.' >&2
      exit 1
    fi
    if [ "$5" != .nsh/out/GlossShift.app ] || [ ! -d "$5" ] || [ -L "$5" ]; then
      printf '%s\n' 'Refusing to sign outside the copied GlossShift build bundle.' >&2
      exit 1
    fi
    # NSH preserves read-only Nix source modes when copying its official runner.
    # Only regular files in this build-local bundle may be rewritten by signing.
    find "$5" -type f -exec chmod u+w {} +
    exec ${rcodesign}/bin/rcodesign sign "$5"
  '';
  runtimeEnvironment = ''
    export GLOSSSHIFT_NODE_COMMAND='${nodeCommand}'
    export GLOSSSHIFT_NODE_ENTRY='@out@/libexec/glossshift/node/main.ts'
    export GLOSSSHIFT_LLAMA_SERVER='${serverCommand}'
    export GLOSSSHIFT_MACOS_HELPER='${helperCommand}'
  '';
in
stdenvNoCC.mkDerivation {
  pname = "glossshift";
  version = "0.2.0";
  src = glossshift-source;
  pnpmDeps = glossshift-pnpm-deps;
  nativeBuildInputs = [
    makeBinaryWrapper
    (lib.getBin darwin.cctools)
    nsh
    nodejs_26
    pnpm
    pnpmConfigHook
    jq
    rcodesign
  ];
  buildPhase = ''
    runHook preBuild
    export PATH="${bundleSigner}/bin:$PATH"
    # Both official prebuilt hosts receive only the exact installed executables.
    for manifest in nsh.json terminal/nsh.json; do
      jq --arg node '${nodeCommand}' --arg helper '${helperCommand}' '
        del(.rust, .icon) |
        .capabilities.process.execute = [$node, $helper] |
        .capabilities.process.env = [
          "HOME", "TMPDIR", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "GLOSSSHIFT_CONFIG",
          "GLOSSSHIFT_NODE_COMMAND", "GLOSSSHIFT_NODE_ENTRY",
          "GLOSSSHIFT_LLAMA_SERVER", "GLOSSSHIFT_MACOS_HELPER", "GLOSSSHIFT_BACKGROUND"
        ]' "$manifest" > "$manifest.new"
      mv "$manifest.new" "$manifest"
    done
    nsh check .
    nsh check terminal
    nsh build . --release
    nsh build terminal --release --out terminal/.nsh/out
    test ! -e .nsh/rust
    test ! -e terminal/.nsh/rust
    for bundle in .nsh/out/bundle.js terminal/.nsh/out/bundle.js; do
      if grep -q 'glossshift/native' "$bundle"; then
        printf '%s\n' 'Official prebuilt bundles must not import a custom native module.' >&2
        exit 1
      fi
    done
    nsh package . --target macos --arch arm64
    app=.nsh/out/GlossShift.app
    cp packaging/GlossShift.icns "$app/Contents/Resources/GlossShift.icns"
    substituteInPlace "$app/Contents/Info.plist" \
      --replace-fail '<key>CFBundleName</key>' \
      '<key>CFBundleIconFile</key><string>GlossShift.icns</string><key>CFBundleName</key>'
    # Finder launches must receive the same immutable runtime paths as CLI launches.
    mv "$app/Contents/MacOS/GlossShift" "$app/Contents/MacOS/GlossShift-host"
    mkdir -p "$app/Contents/Resources/glossshift"
    cat > "$app/Contents/Resources/glossshift/GlossShift-launcher" <<'EOF'
    #!${stdenvNoCC.shell}
    ${runtimeEnvironment}
    export GLOSSSHIFT_BACKGROUND=0
    case "''${1-}" in
      --help|-h)
        printf '%s\n' 'Usage: glossshift [--background | --help | --version]' \
          '       glossshift autostart <enable --app PATH | disable | status>'
        exit 0
        ;;
      --version|-V)
        printf '%s\n' 'glossshift 0.2.0'
        exit 0
        ;;
      autostart|--autostart)
        shift
        exec ${nodeCommand} "$GLOSSSHIFT_NODE_ENTRY" --autostart "$@"
        ;;
      --background)
        export GLOSSSHIFT_BACKGROUND=1
        shift
        ;;
      "") ;;
      *)
        printf '%s\n' 'Unknown GlossShift option. Run glossshift --help.' >&2
        exit 2
        ;;
    esac
    if [ "$#" -ne 0 ]; then
      printf '%s\n' 'Unexpected GlossShift arguments. Run glossshift --help.' >&2
      exit 2
    fi
    exec @out@/Applications/GlossShift.app/Contents/MacOS/GlossShift-host
    EOF
    substituteInPlace "$app/Contents/Resources/glossshift/GlossShift-launcher" --replace-fail @out@ "$out"
    chmod +x "$app/Contents/Resources/glossshift/GlossShift-launcher"
    # CFBundleExecutable must be Mach-O for genuine macOS bundle signing.
    # The standard Nix binary wrapper only dispatches to the audited shell launcher.
    makeBinaryWrapper ${stdenvNoCC.shell} "$app/Contents/MacOS/GlossShift" \
      --add-flag "$out/Applications/GlossShift.app/Contents/Resources/glossshift/GlossShift-launcher"
    rcodesign sign "$app"
    CI=true npm_config_offline=true pnpm prune --prod --ignore-scripts
    runHook postBuild
  '';
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/Applications" "$out/bin" "$out/libexec/glossshift" "$out/share/glossshift/tui"
    cp -R .nsh/out/GlossShift.app "$out/Applications/GlossShift.app"
    ln -s "$out/Applications/GlossShift.app/Contents/MacOS/GlossShift" "$out/bin/glossshift"
    cp -R node_modules package.json "$out/libexec/glossshift/"
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
    # The official TUI host accepts external JS, not external unsigned bytecode.
    cat > "$out/bin/gshift" <<'EOF'
    #!${stdenvNoCC.shell}
    ${runtimeEnvironment}
    if [ "$#" -eq 0 ] || [ "$1" = "--tui" ]; then
      [ "$#" -eq 0 ] || shift
      exec @out@/libexec/glossshift/gshift-tui-host --bundle @out@/share/glossshift/tui/bundle.js "$@"
    else
      exec ${nodeCommand} @out@/libexec/glossshift/node/main.ts "$@"
    fi
    EOF
    substituteInPlace "$out/bin/gshift" --replace-fail @out@ "$out"
    chmod +x "$out/bin/gshift"
    runHook postInstall
  '';
  # Preserve the official runners' signatures and resource layout.
  dontFixup = true;
  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    test -x "$out/bin/glossshift"
    test -x "$out/bin/gshift"
    test -x "$out/libexec/glossshift/gshift-tui-host"
    test -x "$out/Applications/GlossShift.app/Contents/MacOS/GlossShift-host"
    test -x "$out/Applications/GlossShift.app/Contents/Resources/glossshift/GlossShift-launcher"
    test -x '${helperCommand}'
    test -s "$out/share/glossshift/tui/bundle.js"
    test -s "$out/Applications/GlossShift.app/Contents/Resources/nsh/bundle.nshc"
    '${serverCommand}' --version
    "$out/bin/glossshift" --help > /dev/null
    "$out/bin/glossshift" --version > /dev/null
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
