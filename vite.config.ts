import { generateIgnorePatterns } from '@totto2727/gitignore-patterns'
import { defineConfig } from 'vite-plus'

const ignorePatterns = await generateIgnorePatterns(new URL('.', import.meta.url))
const nsh = (args: string) => `nsh ${args}`
const localRuntime = 'GLOSSSHIFT_NODE_COMMAND=node GLOSSSHIFT_NODE_ENTRY="$PWD/node/main.ts"'

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
      typecheck: { command: nsh('check .'), dependsOn: ['typecheck-node', 'typecheck-tui'], cache: false },
      'typecheck-node': { command: nsh('check . -- --project node/tsconfig.json'), cache: false },
      'typecheck-tui': { command: nsh('check terminal'), cache: false },
      dev: { command: `export ${localRuntime}; ${nsh('dev . --target macos')}`, cache: false },
      run: { command: `export ${localRuntime}; ${nsh('run . --target macos')}`, cache: false },
      tui: { command: `export ${localRuntime}; ${nsh('run terminal --target tui')}`, cache: false },
      build: { command: nsh('build . --release'), cache: false },
      'build-tui': { command: nsh('build terminal --release --out terminal/.nsh/out'), cache: false },
      test: { command: nsh('test App.test.ts'), cache: false },
      'test-tui': {
        command: `export ${localRuntime}; ${nsh('test terminal/Tui.test.ts --target tui')}`,
        cache: false,
      },
      'test-local-model': {
        command: `export ${localRuntime}; ${nsh('test terminal/LocalModel.test.ts --target tui')}`,
        cache: false,
      },
      'test-node': { command: nsh('test Node.test.ts --target tui'), cache: false },
      'test-cli': { command: nsh('test node/cli.test.ts --target tui'), cache: false },
      package: { command: nsh('package . --target macos'), cache: false },
      cli: {
        command: `${localRuntime} sh -c 'if [ "$1" = "--" ]; then shift; fi; if [ "$#" -eq 0 ] || [ "$1" = "--tui" ]; then [ "$#" -eq 0 ] || shift; exec nsh run terminal --target tui "$@"; else exec node node/main.ts "$@"; fi' --`,
        cache: false,
      },
    },
  },
})
