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
    ../terminal/App.tsx
    ../terminal/nsh.json
    ../terminal/tsconfig.json
    ../batch/App.tsx
    ../batch/nsh.json
    ../batch/tsconfig.json
    ../platform.ts
    (lib.fileset.difference (modules ../platform) ../platform/App.tsx)
    (lib.fileset.difference (modules ../runtime) ../runtime/cli-host.fixture)
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
