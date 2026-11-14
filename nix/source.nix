{ lib, runCommand, nsh-source }:

let
  source = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../App.tsx
      ../App.test.ts
      ../Tui.test.ts
      ../Node.test.ts
      ../terminal.fixture.tsx
      ../ui.fixture.tsx
      ../nsh.json
      ../src
      ../terminal
      ../node
      ../native/Cargo.toml
      ../native/Cargo.lock
      ../native/src
      ../native/examples
      ../packaging
      ../patches
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../.node-version
      ../.gitignore
      ../vite.config.ts
      ../tsconfig.json
      ./nsh-host-Cargo.lock
    ];
  };
in
runCommand "glossshift-source-with-nsh" { } ''
  cp -R ${source} "$out"
  chmod -R u+w "$out"
  mkdir -p "$out/.nsh"
  cp -R ${nsh-source} "$out/.nsh/upstream"
  chmod -R u+w "$out/.nsh/upstream"
  printf '%s\n' '${nsh-source}' > "$out/.nsh/upstream/.glossshift-source"
''
