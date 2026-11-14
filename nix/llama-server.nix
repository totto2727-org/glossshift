{
  lib,
  stdenvNoCC,
  fetchurl,
}:

stdenvNoCC.mkDerivation {
  pname = "llama-server";
  version = "b12110";

  src = fetchurl {
    url = "https://github.com/ggml-org/llama.cpp/releases/download/b12110/llama-b12110-bin-macos-arm64.tar.gz";
    hash = "sha256-T1uN4S4LlRZljKaldkxv+z18ZZw91ThVaxQTx7QFBmI=";
  };

  dontConfigure = true;
  dontBuild = true;
  # Keep upstream Mach-O signatures and @loader_path dylib resolution intact.
  dontFixup = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin" "$out/share/licenses/llama-server"
    cp -P llama-server lib*.dylib "$out/bin/"
    cp LICENSE "$out/share/licenses/llama-server/LICENSE"
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    "$out/bin/llama-server" --version
    "$out/bin/llama-server" --help > /dev/null
    runHook postInstallCheck
  '';

  meta = {
    description = "Official pinned llama.cpp server binary for Apple Silicon";
    homepage = "https://github.com/ggml-org/llama.cpp";
    license = lib.licenses.mit;
    mainProgram = "llama-server";
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
