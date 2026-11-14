{
  lib,
  stdenvNoCC,
  nodejs_26,
  pnpm,
  pnpmConfigHook,
  makeBinaryWrapper,
  coreutils,
  curl,
  cacert,
  glossshift-cli-source,
  glossshift-pnpm-deps,
  glossshift-llama-server,
}:

stdenvNoCC.mkDerivation {
  pname = "gshift";
  version = "0.2.0";
  src = glossshift-cli-source;
  pnpmDeps = glossshift-pnpm-deps;
  pnpmInstallFlags = [ "--prod" ];
  nativeBuildInputs = [
    nodejs_26
    pnpm
    pnpmConfigHook
    makeBinaryWrapper
  ];
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    mkdir -p "$out/share/gshift" "$out/bin"
    cp -R cli runtime node_modules package.json "$out/share/gshift/"
    rm -f "$out/share/gshift/node_modules/.modules.yaml" "$out/share/gshift/node_modules/.pnpm/lock.yaml"
    makeBinaryWrapper ${nodejs_26}/bin/node "$out/bin/gshift" \
      --add-flag "$out/share/gshift/cli/main.ts" \
      --set GLOSSSHIFT_LLAMA_SERVER '${glossshift-llama-server}/bin/llama-server' \
      --set GLOSSSHIFT_COREUTILS '${coreutils}/bin/coreutils' \
      --set GLOSSSHIFT_CURL '${curl}/bin/curl' \
      --set SSL_CERT_FILE '${cacert}/etc/ssl/certs/ca-bundle.crt'
    runHook postInstall
  '';
  meta = {
    description = "NSH-free Effect CLI for local Markdown translation";
    license = lib.licenses.mit;
    mainProgram = "gshift";
    platforms = [ "aarch64-darwin" ];
  };
}
