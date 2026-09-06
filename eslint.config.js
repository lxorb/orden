// Type-aware linting across the workspace. The rule sets are the strict ones
// on purpose: a rule that only fires on real mistakes earns its place, and the
// few that fight the code's style are turned down below, each with its reason.
import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      '.claude/**',
      'packaging/**',
      'apps/desktop/src-tauri/gen/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    rules: {
      // A promise that nobody awaits or catches is a bug that surfaces as a
      // silent failure; `void promise` says the drop is meant.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Every case of a union handled, or the compiler says which is missing.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      // Numbers in template strings read fine; objects and arrays do not.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      // `catch (error) { ... }` with an unused binding is fine; `_` marks intent.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The codebase explains itself in prose; a non-null assertion is allowed
      // where the line before makes it obvious, and reviewed by eye.
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    files: ['**/*.svelte'],
    rules: {
      // `{@render snippet()}` is a statement in the markup, but the parser hands
      // it over as an expression, so the rule reads every one of them as a void
      // call in the wrong place. Nothing a component can be written differently
      // to avoid, and the rule still holds for every `.ts` file.
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  {
    // Build and tool configuration sits outside every tsconfig, so the rules
    // that need type information cannot see it; the plain rules still apply.
    files: ['**/*.config.{js,ts,mjs}', 'scripts/**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Command-line scripts talk through the console; that is their output.
    files: ['scripts/**/*.{js,mjs}'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      // A stub standing in for a promise-returning API is written `async`
      // because that is what it answers, not because it waits for anything.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
)
