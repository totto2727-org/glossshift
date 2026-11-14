{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:

let
  version = "0.5.0";
  revision = "f4d68f7f9f31eb7b3ecc8a4cbc31096d5c6238a1";
  tui = fetchurl {
    url = "https://api.github.com/repos/longbridge/nsh/releases/assets/735365625";
    name = "nsh-0.5.0-tui-macos-arm64.tar.gz";
    sha256 = "cf289860b75d9fb2e848231d63080207049f31310ae16ca6cc7e36858b54c249";
    curlOptsList = [ "-H" "Accept: application/octet-stream" ];
  };
  compiler = stdenvNoCC.mkDerivation {
    pname = "nsh-typescript";
    version = "7.0.2";
    src = fetchurl {
      url = "https://registry.npmjs.org/@typescript/typescript-darwin-arm64/-/typescript-darwin-arm64-7.0.2.tgz";
      hash = "sha512-gowzar9MwS/aRWp6f3a4KUqzRjAZjOsmGNCM6LcTgXum+dBfgsBVMN+AgvOCCbguXyick6LJhpBszxMebJ8syA==";
    };
    dontBuild = true;
    installPhase = ''
      runHook preInstall
      mkdir -p "$out"
      cp -R . "$out/"
      runHook postInstall
    '';
    dontFixup = true;
  };
in
stdenvNoCC.mkDerivation {
  pname = "nsh";
  inherit version;
  src = fetchurl {
    url = "https://api.github.com/repos/longbridge/nsh/releases/assets/735365672";
    name = "nsh-0.5.0-macos-arm64.tar.gz";
    sha256 = "e6722427b391b00cf7ec13137db9366e78d1e7a045f2933cf00b340365309d9d";
    curlOptsList = [ "-H" "Accept: application/octet-stream" ];
  };
  nativeBuildInputs = [ makeWrapper ];
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/libexec/nsh" "$out/bin"
    cp -R . "$out/libexec/nsh/"
    tar -xzf ${tui} -C "$out/libexec"
    makeWrapper "$out/libexec/nsh/bin/nsh" "$out/bin/nsh" \
      --set NSH_RUNTIME "$out/libexec/nsh/runtime" \
      --set NSH_TSC "${compiler}/lib/tsc"
    runHook postInstall
  '';
  # Preserve upstream signatures on native executables and libraries.
  dontFixup = true;
  passthru = { inherit compiler revision; };
  meta = {
    description = "Pinned official Native Shell CLI with macOS and terminal runtimes";
    homepage = "https://nsh.dev";
    license = lib.licenses.asl20;
    mainProgram = "nsh";
    platforms = [ "aarch64-darwin" ];
  };
}
