{ lib }:

let
  modules =
    directory:
    lib.fileset.fileFilter (
      file: file.hasExt "ts" && !(lib.hasInfix ".test." file.name || lib.hasInfix ".fixture." file.name)
    ) directory;
in
lib.fileset.toSource {
  root = ../.;
  fileset = lib.fileset.unions [
    (modules ../cli)
    (lib.fileset.difference (lib.fileset.difference (modules ../runtime) ../runtime/settings.test) ../runtime/platform.ts)
    ../package.json
    ../pnpm-lock.yaml
    ../pnpm-workspace.yaml
    (../patches + "/plist@5.1.1.patch")
  ];
}
