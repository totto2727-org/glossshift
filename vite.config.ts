import { generateIgnorePatterns } from '@totto2727/gitignore-patterns'
import preset from '@totto2727/oxlint/preset/application'
import { defineConfig } from 'vite-plus'

const ignorePatterns = await generateIgnorePatterns(new URL('.', import.meta.url))
const nsh = (args: string): string => `nsh ${args}`

// oxlint-disable-next-line import/no-default-export -- Vite+ discovers this configuration through the module default.
export default defineConfig({
  fmt: {
    arrowParens: 'always',
    experimentalSortImports: {
      ignoreCase: true,
      newlinesBetween: true,
      order: 'asc',
    },
    experimentalSortPackageJson: true,
    ignorePatterns: [...ignorePatterns, '**/*.ja.md'],
    jsxSingleQuote: true,
    printWidth: 120,
    proseWrap: 'preserve',
    semi: false,
    singleQuote: true,
  },
  lint: {
    env: { node: true },
    extends: [preset],
    ignorePatterns,
    options: { typeAware: false, typeCheck: false },
    overrides: [
      {
        // NSH discovers the native GUI entry from a fixed filename.
        files: ['app/desktop/App.tsx', 'package/nsh-platform/App.tsx'],
        rules: { 'unicorn/filename-case': 'off' },
      },
      {
        // These suites import NSH's native test API. Vitest's import suggestion fails in the NSH host.
        files: ['app/desktop/**/*.test.ts', 'app/desktop/**/*.test.tsx', 'package/nsh-platform/**/*.test.ts'],
        plugins: ['vitest'],
        rules: { 'vitest/prefer-importing-vitest-globals': 'off' },
      },
    ],
  },
  run: {
    tasks: {
      build: { cache: false, command: nsh('build app/desktop --release') },
      check: 'vp check',
      ci: { command: '', dependsOn: ['check'] },
      cli: {
        cache: false,
        command: `sh -c 'if [ "$1" = "--" ]; then shift; fi; exec node app/cli/src/main.ts "$@"' --`,
      },
      dev: { cache: false, command: nsh('dev app/desktop --target macos') },
      fix: 'vp check --fix',
      package: { cache: false, command: nsh('package app/desktop --target macos') },
      run: { cache: false, command: nsh('run app/desktop --target macos') },
      test: { cache: false, command: nsh('test app/desktop/app.test.ts') },
      'test-cli': { cache: false, command: 'vp test run' },
      'test-inference': {
        cache: false,
        command: `${nsh('test app/desktop/inference.test.ts')} && ${nsh('test app/desktop/inference-policy.test.ts')}`,
      },
      'test-platform': { cache: false, command: nsh('test package/nsh-platform --target tui') },
      'test-settings': { cache: false, command: nsh('test app/desktop/desktop-config.test.ts --target tui') },
      typecheck: { cache: false, command: 'vp run -r typecheck' },
    },
  },
  test: { dir: 'app/cli' },
})
