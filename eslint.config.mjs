import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.nyc_output/**',
      'examples/**',
      'doc/**',
      'tools/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Legacy CommonJS source — kept lax until migrated to TypeScript file-by-file.
  // Each rule disabled here should be deleted as the relevant file becomes .ts.
  {
    files: ['lib/**/*.js', 'index.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-unused-vars': 'off',
      'no-useless-escape': 'off',
      'no-cond-assign': 'off',
      'no-redeclare': 'off',
      'no-prototype-builtins': 'off',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  },
  // Legacy mocha tests — same treatment.
  {
    files: ['test/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      'no-unused-vars': 'off',
      'no-unused-expressions': 'off',
      'no-redeclare': 'off',
      'no-irregular-whitespace': 'off',
      'no-prototype-builtins': 'off',
    },
  },
  // New TypeScript code — strict.
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
];
