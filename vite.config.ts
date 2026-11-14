import { generateIgnorePatterns } from '@totto2727/gitignore-patterns'
import { defineConfig } from 'vite-plus'

const ignorePatterns = await generateIgnorePatterns(new URL('.', import.meta.url))
const native = (args: string) => `CARGO_TARGET_DIR="$PWD/target" cargo ${args} --manifest-path native/Cargo.toml`
const nsh = (args: string) =>
  `test -f .nsh/upstream/.glossshift-source || { printf '%s\\n' 'Run nix develop to prepare the pinned NSH source cache.' >&2; exit 1; }; CARGO_TARGET_DIR="$PWD/target" nsh ${args}`

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
      typecheck: { command: nsh('check .'), dependsOn: ['typecheck-node'], cache: false },
      'typecheck-node': { command: nsh('check . -- --project node/tsconfig.json'), cache: false },
      dev: { command: nsh('dev . --target macos'), cache: false },
      run: { command: nsh('run . --target macos'), cache: false },
      tui: { command: nsh('run . --target tui'), cache: false },
      build: { command: nsh('build . --release'), cache: false },
      test: { command: nsh('test App.test.ts'), cache: false },
      'test-tui': { command: nsh('test Tui.test.ts --target tui'), cache: false },
      'test-local-model': { command: nsh('test LocalModel.test.ts --target tui'), cache: false },
      'test-node': { command: nsh('test Node.test.ts --target tui'), cache: false },
      'test-cli': { command: nsh('test node/cli.test.ts --target tui'), cache: false },
      'test-native': { command: native('test --lib'), cache: false },
      'test-lifecycle': { command: `${native('run')} --example lifecycle_probe`, cache: false },
      package: { command: nsh('package . --target macos'), cache: false },
      cli: {
        command: `CARGO_TARGET_DIR="$PWD/target" sh -c 'if [ "$1" = "--" ]; then shift; fi; if [ "$#" -eq 0 ] || [ "$1" = "--tui" ]; then [ "$#" -eq 0 ] || shift; exec nsh run . --target tui "$@"; else exec node node/main.ts "$@"; fi' --`,
        cache: false,
      },
    },
  },
})
