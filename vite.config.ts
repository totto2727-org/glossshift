import { generateIgnorePatterns } from '@totto2727/gitignore-patterns'
import { defineConfig } from 'vite-plus'

const ignorePatterns = await generateIgnorePatterns(new URL('.', import.meta.url))
const nsh = (args: string) => `nsh ${args}`

export default defineConfig({
  fmt: {
    ignorePatterns: [...ignorePatterns, '**/*.ja.md'],
    arrowParens: 'always',
    experimentalSortImports: {
      ignoreCase: true,
      newlinesBetween: true,
      order: 'asc',
    },
    experimentalSortPackageJson: true,
    jsxSingleQuote: true,
    printWidth: 120,
    proseWrap: 'preserve',
    semi: false,
    singleQuote: true,
  },
  lint: { ignorePatterns, options: { typeAware: false, typeCheck: false } },
  run: {
    tasks: {
      check: 'vp check',
      fix: 'vp check --fix',
      ci: { command: '', dependsOn: ['check'] },
      typecheck: {
        command: nsh('check .'),
        dependsOn: ['typecheck-runtime', 'typecheck-tui', 'typecheck-batch'],
        cache: false,
      },
      'typecheck-runtime': { command: nsh('check . -- --project runtime/tsconfig.json'), cache: false },
      'typecheck-batch': { command: nsh('check batch'), cache: false },
      'typecheck-tui': { command: nsh('check terminal'), cache: false },
      dev: { command: nsh('dev . --target macos'), cache: false },
      run: { command: nsh('run . --target macos'), cache: false },
      tui: { command: nsh('run terminal --target tui'), cache: false },
      build: { command: nsh('build . --release'), cache: false },
      'build-tui': { command: nsh('build terminal --release --out terminal/.nsh/out'), cache: false },
      test: { command: nsh('test App.test.ts'), cache: false },
      'build-batch': { command: nsh('build batch --release --out batch/.nsh/out'), cache: false },
      'test-platform': { command: nsh('test platform --target tui'), cache: false },
      'test-inference': {
        command: `${nsh('test Inference.test.ts')} && ${nsh('test InferencePolicy.test.ts')} && ${nsh('test InferenceStorage.test.ts --target tui')}`,
        cache: false,
      },
      'test-settings': { command: nsh('test DesktopConfig.test.ts --target tui'), cache: false },
      'test-tui': { command: nsh('test terminal/Tui.test.ts --target tui'), cache: false },
      'test-local-model': { command: nsh('test InferenceModel.test.ts --target tui'), cache: false },
      'test-cli': { command: nsh('test runtime/cli.test.ts --target tui'), cache: false },
      'test-helper': {
        command:
          'mkdir -p tmp/helper-tests && swiftc -module-cache-path "$PWD/tmp/helper-tests/module-cache" helper/Selection.swift helper/tests/SelectionTests.swift -o tmp/helper-tests/selection-tests && tmp/helper-tests/selection-tests',
        cache: false,
      },
      'test-packaging': {
        command: `GLOSSSHIFT_TEST_ROOT="$PWD" GLOSSSHIFT_TEST_BATCH_BUNDLE="$PWD/batch/.nsh/out/bundle.js" ${nsh('test packaging/Acceptance.test.ts --target tui')}`,
        dependsOn: ['build-batch'],
        cache: false,
      },
      package: { command: nsh('package . --target macos'), cache: false },
      cli: {
        command: `sh -c 'if [ "$1" = "--" ]; then shift; fi; if [ "$#" -eq 0 ] || [ "$1" = "--tui" ]; then [ "$#" -eq 0 ] || shift; exec nsh run terminal --target tui "$@"; else nsh build batch --release --out batch/.nsh/out >&2 && exec "\${GLOSSSHIFT_BATCH_LAUNCHER:?Run nix develop to prepare the batch launcher}" "$@"; fi' --`,
        cache: false,
      },
    },
  },
})
