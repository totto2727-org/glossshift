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
    ../app/cli/package.json
    (modules ../app/cli/src)
    ../package/runtime/package.json
    (modules ../package/runtime/src)
    ../package.json
    ../pnpm-lock.yaml
    ../pnpm-workspace.yaml
    (../patches + "/plist@5.1.1.patch")
  ];
}
