import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';
import prettierPlugin from 'eslint-plugin-prettier';
import sonarjs from 'eslint-plugin-sonarjs';
import securityPlugin from 'eslint-plugin-security';
import importPlugin from 'eslint-plugin-import';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'examples/**', 'doc/**', 'tools/**'],
  },
  js.configs.recommended,
  sonarjs.configs.recommended,
  securityPlugin.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  // Test fixtures (CJS preset modules dynamically required by the args/processor tests).
  {
    files: ['test/assets/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.ts', '**/*.mts', 'test/**/*.ts'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.es2021, ...globals.node },
      ecmaVersion: 'latest',
    },
    plugins: {
      prettier: prettierPlugin,
      import: importPlugin,
    },
    rules: {
      // ── TypeScript strictness ──────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      // Documented '!' on _currentOutput / _currentInput — the FfmpegCommand
      // constructor guarantees they're set before any option method is
      // callable, but the type model carries them as optional because of
      // the constructor bootstrap. Off rather than per-line disables.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Off: ffprobe.ts lifts legacy `TAG:*` / `DISPOSITION:*` keys into
      // nested `tags` / `disposition` bags, which requires dynamic delete
      // of arbitrary string keys. The shape comes from external ffprobe
      // output, not user input.
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-useless-empty-export': 'error',
      // Off: cosmetic preference between `foo(): bar` and `foo: () => bar`
      // on interfaces. EventEmitter overload typings rely on the method
      // form; flipping all interfaces in lib/types.ts would force a wider
      // rewrite for no behavioural win.
      '@typescript-eslint/method-signature-style': 'off',
      // Off: ffprobe(file, index, cb) and ffprobe(file, options, cb) are
      // deliberately separate overloads to keep the by-index vs by-options
      // intent visible at call sites. Combining them as
      // `(file, indexOrOptions, cb)` would erase that.
      '@typescript-eslint/unified-signatures': 'off',
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-use-before-define': [
        'error',
        {
          functions: false,
          classes: true,
          variables: true,
          enums: true,
          typedefs: true,
          ignoreTypeReferences: true,
        },
      ],
      'no-use-before-define': 'off',

      // ── General JS rules ───────────────────────────────────────
      eqeqeq: ['error', 'smart'],
      'no-throw-literal': 'error',
      'no-implicit-coercion': [
        'error',
        { boolean: true, number: true, string: true, disallowTemplateShorthand: false },
      ],
      'no-unneeded-ternary': ['error', { defaultAssignment: false }],
      'no-else-return': ['error', { allowElseIf: false }],
      'default-case-last': 'error',
      'prefer-template': 'error',
      'prefer-arrow-callback': 'error',
      'arrow-body-style': ['error', 'as-needed'],
      // Off: option modules deliberately use chained assignment to wire
      // multiple aliases to the same implementation (`proto.withFoo =
      // proto.foo = function() {...}`). Behaviour ported verbatim from
      // legacy and re-expressed via `Object.assign` would obscure intent.
      'no-multi-assign': 'off',
      'prefer-rest-params': 'error',
      'prefer-spread': 'error',
      'no-self-compare': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-constructor-return': 'error',
      'array-callback-return': 'error',
      'default-param-last': 'error',
      'no-new-wrappers': 'error',
      'no-octal-escape': 'error',
      'no-proto': 'error',
      'no-script-url': 'error',
      'no-useless-call': 'error',
      'no-useless-concat': 'error',
      'no-useless-rename': 'error',
      radix: 'error',
      'prefer-object-spread': 'error',
      'prefer-numeric-literals': 'error',
      'prefer-promise-reject-errors': 'error',
      'no-lonely-if': 'error',
      'no-floating-decimal': 'error',
      'no-unused-private-class-members': 'error',
      'no-loop-func': 'error',
      'no-new': 'error',
      'no-undef-init': 'error',
      'no-useless-return': 'error',
      'prefer-regex-literals': 'error',
      'prefer-exponentiation-operator': 'error',
      'consistent-return': 'error',
      complexity: ['error', { max: 15 }],
      'max-depth': ['error', { max: 4 }],
      'max-params': ['error', { max: 6 }],
      'no-shadow': 'error',
      'no-param-reassign': 'error',
      'prefer-const': 'error',
      'no-return-assign': 'error',
      'object-shorthand': 'error',

      // ── Import plugin ─────────────────────────────────────────
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-duplicates': 'error',
      'import/no-mutable-exports': 'error',
      'import/no-self-import': 'error',
      'import/no-useless-path-segments': 'error',

      // ── Prettier ──────────────────────────────────────────────
      'prettier/prettier': 'error',

      // ── SonarJS tuning ────────────────────────────────────────
      'sonarjs/cognitive-complexity': 'error',
      'sonarjs/no-ignored-exceptions': 'error',
      'sonarjs/no-commented-code': 'off',
      'sonarjs/no-nested-conditional': 'off',
      // The library is callback-heavy by nature (ffmpeg child processes,
      // event listeners, stream pipelines). Nested callbacks 4–5 deep are
      // routine; restructuring would obscure the control flow.
      'sonarjs/no-nested-functions': 'off',
      // The legacy regexes (codec parser, time-mark parser, format parser)
      // were ported verbatim with intentional behaviour-equivalence. Fixing
      // them risks parser drift; reviewed and accepted as-is.
      'sonarjs/concise-regex': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/regex-complexity': 'off',
      'sonarjs/single-char-in-character-classes': 'off',
      // Library spawns external CLIs (ffmpeg/ffprobe/flvmeta) by name on PATH —
      // that's the whole point of the package, not a security risk.
      'sonarjs/no-os-command-from-path': 'off',
      // @typescript-eslint/no-unused-vars already covers this with the
      // ^_ ignore pattern; sonarjs version has no options.
      'sonarjs/no-unused-vars': 'off',

      // ── Security plugin tuning ────────────────────────────────
      // Disabled: high false-positive rate against this codebase's patterns
      // (every fs.access(<computed-path>) gets flagged, every regex built
      // from configurable args gets flagged, etc.).
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-child-process': 'off', // spawn(ffmpeg, args) is the library's purpose
    },
  },
  prettierConfig,
];
