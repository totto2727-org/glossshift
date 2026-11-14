{ lib }:

let
  # Only production modules are package inputs. Tests run through development tasks.
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
    ../App.tsx
    ../nsh.json
    (modules ../src)
    ../platform.ts
    (lib.fileset.difference (modules ../platform) ../platform/App.tsx)
    (lib.fileset.difference (lib.fileset.difference (modules ../runtime) ../runtime/settings.test) ../runtime/main.ts)
    ../runtime/tsconfig.json
    ../packaging/app-icon.png
    ../packaging/GlossShift.icns
    ../packaging/tray-icon.svg
    (../patches + "/plist@5.1.1.patch")
    ../package.json
    ../pnpm-lock.yaml
    ../pnpm-workspace.yaml
    ../tsconfig.json
  ];
}
