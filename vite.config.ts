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
      test: { command: nsh('test app/desktop/app.test.ts'), cache: false },
      'test-platform': { command: nsh('test package/nsh-platform --target tui'), cache: false },
      'test-inference': {
        command: `${nsh('test app/desktop/inference.test.ts')} && ${nsh('test app/desktop/inferencePolicy.test.ts')}`,
        cache: false,
      },
      'test-settings': { command: nsh('test app/desktop/desktopConfig.test.ts --target tui'), cache: false },
      'test-cli': { command: 'vp test run', cache: false },
      package: { command: nsh('package app/desktop --target macos'), cache: false },
      cli: {
        command: `sh -c 'if [ "$1" = "--" ]; then shift; fi; exec node app/cli/src/main.ts "$@"' --`,
        cache: false,
      },
    },
  },
})
