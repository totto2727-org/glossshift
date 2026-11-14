{ lib, fetchPnpmDeps, pnpm }:

fetchPnpmDeps {
  pname = "glossshift";
  version = "0.2.0";
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
    ];
  };
  inherit pnpm;
  fetcherVersion = 4;
  hash = "sha256-qh4E48I+7JqvLjzwyIg4ksAyO99CJuNPxspmEpMudXE=";
}
