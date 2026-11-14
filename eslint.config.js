import js from '@eslint/js'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { existsSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { check as checkModules, moduleOf, ROOT } from './scripts/modules.mjs'

const DIRECTIVE =
  /^\s*(?:eslint(?:-disable|-enable)?(?:-next-line|-line)?\s|global\s|@ts-(?:expect-error|ignore|nocheck|check)\b|@vitest-environment\s|prettier-ignore\b|svelte-ignore\s|@vite-ignore\s*$|[@#]__PURE__\s*$|__[A-Z_]+__\s*$|kept\s*$|\*\s*@(?:public|internal)\s*$|\/\s*<reference\s)/

const noComments = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: { prose: 'No comments in code: a directive to a tool, or nothing.' },
  },
  create(context) {
    const source = context.sourceCode
    const alone = (comment) => {
      const node = source.getNodeByRangeIndex(comment.range[0])
      return node?.type === 'BlockStatement' && node.body.length === 0
    }
    return {
      Program() {
        for (const comment of source.getAllComments())
          if (comment.type !== 'Shebang' && !DIRECTIVE.test(comment.value) && !alone(comment))
            context.report({ loc: comment.loc, messageId: 'prose' })
      },
      SvelteHTMLComment(node) {
        if (!DIRECTIVE.test(node.value)) context.report({ node, messageId: 'prose' })
      },
    }
  },
}

const noSpreadMath = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      spread:
        'Math.min and Math.max over a spread throw past some 65,000 values in WebKit: reduce the array instead.',
    },
  },
  create(context) {
    return {
      "CallExpression[callee.object.name='Math'][callee.property.name=/^(min|max)$/] > SpreadElement"(
        node,
      ) {
        context.report({ node, messageId: 'spread' })
      },
    }
  },
}

const noCopyAppend = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      copy: 'Copying a list to add one item to it makes building the map quadratic: push onto the list instead.',
    },
  },
  create(context) {
    return {
      "CallExpression[callee.property.name='set'] > ArrayExpression.arguments"(node) {
        const [first, second] = node.elements
        const read = first?.type === 'SpreadElement' ? first.argument : null
        if (
          node.elements.length === 2 &&
          second?.type !== 'SpreadElement' &&
          read?.type === 'LogicalExpression' &&
          read.operator === '??' &&
          read.left.type === 'CallExpression' &&
          read.left.callee.type === 'MemberExpression' &&
          read.left.callee.property.name === 'get'
        ) {
          context.report({ node, messageId: 'copy' })
        }
      },
    }
  },
}

const MODULES = checkModules().modules.filter((one) => one.lang === 'ts')

const MODULE_FILES = MODULES.map((one) => `${one.dir}/**/*.{ts,svelte}`)

const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '.js', '/index.ts']

function moduleOfSpecifier(from, specifier) {
  if (specifier.startsWith('.')) {
    const target = resolve(dirname(from), specifier)
    const file =
      ENDINGS.map((one) => target + one).find((one) => existsSync(one) && statSync(one).isFile()) ??
      target
    return { module: moduleOf(file, MODULES), file, subpath: null }
  }
  if (!specifier.startsWith('@orden/')) return null
  const [, name, ...rest] = specifier.split('/')
  const module = MODULES.find((one) => one.packageName === `@orden/${name}`) ?? null
  return { module, file: null, subpath: rest.length > 0 ? rest.join('/') : null, name }
}

function eachImport(context, seen) {
  const from = context.filename
  const own = moduleOf(from, MODULES)
  if (!own) return {}
  const look = (node, specifier) => {
    if (typeof specifier !== 'string') return
    const found = moduleOfSpecifier(from, specifier)
    if (!found) return
    seen(node, specifier, own, found)
  }
  return {
    ImportDeclaration: (node) => look(node, node.source.value),
    ExportNamedDeclaration: (node) => node.source && look(node, node.source.value),
    ExportAllDeclaration: (node) => look(node, node.source.value),
    ImportExpression: (node) => node.source.type === 'Literal' && look(node, node.source.value),
  }
}

const noDeepImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      deep: "Import module '{{name}}' through its api ({{api}}), not {{what}}.",
    },
  },
  create(context) {
    return eachImport(context, (node, specifier, own, found) => {
      const { module } = found
      if (!module || module === own) return
      const api = resolve(module.absolute, module.api)
      const past = found.file ? found.file !== api : found.subpath !== null
      if (past) {
        context.report({
          node,
          messageId: 'deep',
          data: { name: module.name, api: `${module.dir}/${module.api}`, what: specifier },
        })
      }
    })
  },
}

const pendingImports = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      pending:
        "Module '{{own}}' imports {{what}}, which is not a module yet; reach it through a port or list '{{path}}' under pending in {{file}} until it is extracted.",
    },
  },
  create(context) {
    return eachImport(context, (node, specifier, own, found) => {
      if (found.module || !found.file) return
      if (!found.file.startsWith(ROOT + sep) || found.file.includes(`${sep}node_modules${sep}`))
        return
      const path = relative(ROOT, found.file).split(sep).join('/')
      if (own.pending.some((one) => path === one || path.startsWith(one))) return
      context.report({
        node,
        messageId: 'pending',
        data: { own: own.name, what: specifier, path, file: own.file },
      })
    })
  },
}

const declaredDependencies = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      undeclared:
        "Module '{{own}}' imports '{{target}}' without naming it in {{file}}; add it to dependsOn or drop the import.",
    },
  },
  create(context) {
    return eachImport(context, (node, specifier, own, found) => {
      const target = found.module?.name ?? found.name ?? null
      if (!target || target === own.name) return
      if (!own.dependsOn.includes(target)) {
        context.report({
          node,
          messageId: 'undeclared',
          data: { own: own.name, target, file: own.file },
        })
      }
    })
  },
}

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
    files: ['apps/**/*.{ts,svelte}'],
    ignores: ['apps/desktop/src/lib/platform/src/motion.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'svelte/transition',
              importNames: ['blur', 'draw', 'fade', 'fly', 'scale', 'slide'],
              message:
                'Take a transition from lib/motion: one that does not move leaves the layout alone.',
            },
          ],
        },
      ],
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
      'apps/desktop/src-tauri/src/web_bars.js',
      'apps/desktop/src-tauri/src/web_pass.js',
      'apps/desktop/src-tauri/src/window_drag.js',
      'apps/desktop/src-tauri/src/page_drag.js',
      'apps/desktop/src-tauri/src/gpu.js',
      'apps/desktop/src-tauri/src/page_scale.js',
      'apps/desktop/src-tauri/src/keyboard_press.js',
      'apps/desktop/src-tauri/src/page_scheme.js',
      'apps/desktop/src-tauri/src/kept.js',
      'apps/desktop/src-tauri/src/former.js',
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
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "NewExpression[callee.name='URL'][arguments.1.object.type='MetaProperty'][arguments.0.value=/\\.(ts|js|mjs|svelte)$/]:not(MemberExpression > NewExpression.object)",
          message:
            'Name a file a test reads with join(import.meta.dirname, …): knip takes new URL(…, import.meta.url) for an entry and stops checking what the file exports.',
        },
      ],
    },
  },
  {
    plugins: {
      orden: {
        rules: {
          'no-comments': noComments,
          'no-spread-math': noSpreadMath,
          'no-copy-append': noCopyAppend,
          'no-deep-imports': noDeepImports,
          'declared-dependencies': declaredDependencies,
          'pending-imports': pendingImports,
        },
      },
    },
    rules: { 'orden/no-comments': 'error' },
  },
  {
    files: MODULE_FILES,
    ignores: ['**/*.test.ts', '**/test/**'],
    rules: {
      'orden/no-deep-imports': 'error',
      'orden/declared-dependencies': 'error',
      'orden/pending-imports': 'error',
    },
  },
  {
    ignores: [
      '**/*.test.ts',
      '**/test/**',
      'apps/desktop/src/lib/chats/**',
      'packages/chats/**',
      'services/sync/src/sync-server-chats/src/chats/**',
    ],
    rules: { 'orden/no-spread-math': 'error', 'orden/no-copy-append': 'error' },
  },
  {
    files: [
      'services/sync/src/sync-server-blog/src/math.ts',
      'services/sync/src/sync-server-blog/src/script.ts',
      'services/sync/src/sync-server-blog/src/style.ts',
      'packages/markdown/src/embeddable.ts',
    ],
    rules: { 'orden/no-comments': 'off' },
  },
)
