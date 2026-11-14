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
      (../patches + "/plist@5.1.1.patch")
    ];
  };
  inherit pnpm;
  fetcherVersion = 4;
  hash = "sha256-lWFO9osZzdg+8VOOqwVKSBMcPAAjk7NPFkSXlJjZy/8=";
}
