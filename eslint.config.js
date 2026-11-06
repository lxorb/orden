import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-before/**',
      '**/dist-profile/**',
      '**/dist-even/**',
      '**/dist-worker/**',
      '**/dist-handoff/**',
      '**/target/**',
      'apps/desktop/test/e2e/shots/**',
      '**/.wrangler/**',
      '.claude/**',
      'packaging/**',
      'apps/desktop/src-tauri/gen/**',
      'docs/**',
      'apps/desktop/src-tauri/src/extensions/firefox/browser-polyfill.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        __EVEN_BUILD__: 'readonly',
        __EVEN_PLUGIN__: 'readonly',
        __DRIVEABLE__: 'readonly',
        __APP_VERSION__: 'readonly',
        __APP_COMMIT__: 'readonly',
        __CLAUDE_CODE__: 'readonly',
      },
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
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
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
      '@typescript-eslint/no-confusing-void-expression': 'off',
    },
  },
  {
    files: ['**/*.config.{js,ts,mjs}', 'scripts/**/*.{js,mjs,ts}', 'apps/cli/**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['scripts/**/*.{js,mjs,ts}', 'apps/cli/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    files: [
      'apps/desktop/public/*.js',
      'apps/desktop/src-tauri/src/web_state/scripts/*.js',
      'apps/desktop/src-tauri/src/web_tabs/*.js',
      'apps/desktop/src-tauri/src/web_swipe.js',
      'apps/desktop/src-tauri/src/web_media.js',
      'apps/desktop/src-tauri/src/window_drag.js',
      'apps/desktop/src-tauri/src/page_drag.js',
      'apps/desktop/src-tauri/src/gpu.js',
      'apps/desktop/src-tauri/src/page_scale.js',
      'apps/desktop/src-tauri/src/keyboard_press.js',
      'apps/desktop/src-tauri/src/page_scheme.js',
      'apps/desktop/src-tauri/src/kept.js',
      'apps/desktop/src-tauri/src/agents/engines/snapshot.js',
      'apps/desktop/src-tauri/src/extensions/firefox/*.js',
      'packages/editor/src/frame-script.js',
    ],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['apps/desktop/src-tauri/src/extensions/firefox/*.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.webextensions } },
  },
  {
    files: ['services/sync/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...[
          'AssignmentPattern > Identifier.right',
          'AssignmentExpression > Identifier.right',
          'Property > Identifier.value',
          'PropertyDefinition > Identifier.value',
        ].map((where) => ({
          selector: `${where}[name='fetch']`,
          message: 'Wrap a stored fetch: (input, init) => fetch(input, init).',
        })),
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
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
