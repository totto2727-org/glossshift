{ lib }:

lib.fileset.toSource {
  root = ../.;
  fileset = lib.fileset.unions [
    ../App.tsx
    ../App.test.ts
    ../Tui.test.ts
    ../DesktopConfig.test.ts
    ../Inference.test.ts
    ../InferenceModel.test.ts
    ../InferencePolicy.test.ts
    ../InferenceStorage.test.ts
    ../terminal.fixture.tsx
    ../ui.fixture.tsx
    ../nsh.json
    ../src
    ../terminal
    ../batch
    ../platform
    ../runtime
    ../packaging
    (../patches + "/plist@5.1.1.patch")
    ../package.json
    ../pnpm-lock.yaml
    ../pnpm-workspace.yaml
    ../.node-version
    ../.gitignore
    ../vite.config.ts
    ../tsconfig.json
  ];
}
