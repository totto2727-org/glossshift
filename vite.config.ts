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
  test: {
    include: ['cli/**/*.test.ts', 'runtime/cli.test.ts', 'packaging/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tmp/**', '.nsh/**', 'packaging/e2e.test/**'],
  },
  run: {
    tasks: {
      check: 'vp check',
      fix: 'vp check --fix',
      ci: { command: '', dependsOn: ['check'] },
      typecheck: {
        command: nsh('check .'),
        dependsOn: ['typecheck-runtime', 'typecheck-cli'],
        cache: false,
      },
      'typecheck-runtime': { command: nsh('check . -- --project runtime/tsconfig.json'), cache: false },
      'typecheck-cli': { command: 'vp exec tsc --project cli/tsconfig.json', cache: false },
      dev: { command: nsh('dev . --target macos'), cache: false },
      run: { command: nsh('run . --target macos'), cache: false },
      build: { command: nsh('build . --release'), cache: false },
      test: { command: nsh('test App.test.ts'), cache: false },
      'test-platform': { command: nsh('test platform --target tui'), cache: false },
      'test-inference': {
        command: `${nsh('test Inference.test.ts')} && ${nsh('test InferencePolicy.test.ts')} && ${nsh('test InferenceStorage.test.ts --target tui')}`,
        cache: false,
      },
      'test-settings': { command: nsh('test DesktopConfig.test.ts --target tui'), cache: false },
      'test-local-model': { command: 'vp test run packaging/Inference.test.ts', cache: false },
      'test-cli': { command: 'vp test run cli/main.test.ts runtime/cli.test.ts', cache: false },
      'test-helper': {
        command:
          'mkdir -p tmp/helper-tests && swiftc -module-cache-path "$PWD/tmp/helper-tests/module-cache" helper/Selection.swift helper/selection.test/Selection.test.swift -o tmp/helper-tests/selection-tests && tmp/helper-tests/selection-tests',
        cache: false,
      },
      'test-packaging': {
        command: 'vp test run packaging',
        cache: false,
      },
      package: { command: nsh('package . --target macos'), cache: false },
      cli: {
        command: `sh -c 'if [ "$1" = "--" ]; then shift; fi; exec node cli/main.ts "$@"' --`,
        cache: false,
      },
    },
  },
})
