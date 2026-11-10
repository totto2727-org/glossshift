{
  lib,
  stdenvNoCC,
  fetchurl,
  makeWrapper,
}:

let
  version = "0.4.0-nightly-c5214aa";
  revision = "c5214aaf4bbdf33bc1d59e9595e009b6aa54d702";
  tui = fetchurl {
    url = "https://api.github.com/repos/longbridge/nsh/releases/assets/730420167";
    name = "nsh-nightly-c5214aa-tui-macos-arm64.tar.gz";
    sha256 = "2fbbb28e32caa312753288b73ad6726f7169042ad9d6b30fa32d21b3ec2e8657";
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
    url = "https://api.github.com/repos/longbridge/nsh/releases/assets/730419932";
    name = "nsh-nightly-c5214aa-macos-arm64.tar.gz";
    sha256 = "b8a8c2f8cebfa9412717b4e7c4478c9a5be8b098e85c7f5f8dfe2f8f6b43b84a";
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
    description = "Pinned nightly Native Shell CLI with official macOS and terminal runtimes";
    homepage = "https://nsh.dev";
    license = lib.licenses.asl20;
    mainProgram = "nsh";
    platforms = [ "aarch64-darwin" ];
  };
}
