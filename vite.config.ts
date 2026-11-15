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
  test: { dir: 'app/cli' },
  run: {
    tasks: {
      check: 'vp check',
      fix: 'vp check --fix',
      ci: { command: '', dependsOn: ['check'] },
      typecheck: { command: 'vp run -r typecheck', cache: false },
      dev: { command: nsh('dev app/desktop --target macos'), cache: false },
      run: { command: nsh('run app/desktop --target macos'), cache: false },
      build: { command: nsh('build app/desktop --release'), cache: false },
      test: { command: nsh('test app/desktop/App.test.ts'), cache: false },
      'test-platform': { command: nsh('test package/nsh-platform --target tui'), cache: false },
      'test-inference': {
        command: `${nsh('test app/desktop/Inference.test.ts')} && ${nsh('test app/desktop/InferencePolicy.test.ts')} && ${nsh('test app/desktop/InferenceStorage.test.ts --target tui')}`,
        cache: false,
      },
      'test-settings': { command: nsh('test app/desktop/DesktopConfig.test.ts --target tui'), cache: false },
      'test-local-model': { command: 'vp test run app/cli/packaging.test/Inference.test.ts', cache: false },
      'test-cli': { command: 'vp test run app/cli/src', cache: false },
      'test-helper': {
        command:
          'mkdir -p tmp/helper-tests && swiftc -module-cache-path "$PWD/tmp/helper-tests/module-cache" helper/Selection.swift helper/selection.test/Selection.test.swift -o tmp/helper-tests/selection-tests && tmp/helper-tests/selection-tests',
        cache: false,
      },
      'test-packaging': {
        command: 'vp test run app/cli/packaging.test',
        cache: false,
      },
      package: { command: nsh('package app/desktop --target macos'), cache: false },
      cli: {
        command: `sh -c 'if [ "$1" = "--" ]; then shift; fi; exec node app/cli/src/main.ts "$@"' --`,
        cache: false,
      },
    },
  },
})
