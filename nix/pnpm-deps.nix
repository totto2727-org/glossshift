{
  lib,
  fetchPnpmDeps,
  pnpm,
}:

fetchPnpmDeps {
  pname = "glossshift";
  version = "0.2.0";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../app/cli/package.json
      ../app/desktop/package.json
      ../package/nsh-platform/package.json
      ../package/runtime/package.json
      (../patches + "/plist@5.1.1.patch")
    ];
  };
  inherit pnpm;
  fetcherVersion = 4;
  hash = "sha256-k5kJgx1hInziovbHdqqdIwtulS0T//WZPTPZCoJLCIE=";
}
