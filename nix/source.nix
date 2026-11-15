{ lib }:

let
  modules =
    directory:
    lib.fileset.fileFilter (
      file:
      (file.hasExt "ts" || file.hasExt "tsx")
      && !(lib.hasInfix ".test." file.name || lib.hasInfix ".fixture." file.name)
    ) directory;
in
lib.fileset.toSource {
  root = ../.;
  fileset = lib.fileset.unions [
    (modules ../app/desktop)
    ../app/desktop/nsh.json
    ../app/desktop/package.json
    ../app/desktop/tsconfig.json
    ../app/desktop/packaging/app-icon.png
    ../app/desktop/packaging/GlossShift.icns
    ../app/desktop/packaging/tray-icon.svg
    ../package/nsh-platform/package.json
    ../package/nsh-platform/platform.ts
    (modules ../package/nsh-platform/platform)
    ../package/runtime/package.json
    (modules ../package/runtime/src)
    (../patches + "/plist@5.1.1.patch")
    ../package.json
    ../pnpm-lock.yaml
    ../pnpm-workspace.yaml
    ../tsconfig.base.json
  ];
}
