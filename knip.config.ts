import type { KnipConfig } from 'knip'

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g
const STYLE = /<style\b[^>]*>[\s\S]*?<\/style>/g
const NOTE = /<!--[\s\S]*?-->/g
const LOADED = /(?<![.\w$#])import\(\s*(['"])([^'"]+)\1\s*\)/g
const OWN = /^(\s*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|class\b)/gm

function svelte(text: string): string {
  const scripts = [...text.matchAll(SCRIPT)].map(([, how = '', code = '']) =>
    /\bmodule\b/.test(how) ? code : code.replace(OWN, '$1'),
  )
  const markup = text.replace(SCRIPT, '').replace(STYLE, '').replace(NOTE, '')
  const loaded = [...markup.matchAll(LOADED)].map(
    ([, , path = '']) => `void import('${path}').then(Object.keys)`,
  )
  return [...scripts, ...loaded].join(';\n')
}

export default {
  compilers: { svelte },
  ignore: [
    'apps/desktop/public/sw.js',
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
    'apps/desktop/src-tauri/src/former.js',
    'apps/desktop/src-tauri/src/kept.js',
    'apps/desktop/src-tauri/src/agents/engines/snapshot.js',
    'apps/desktop/src-tauri/src/extensions/firefox/*.js',
  ],
  workspaces: {
    '.': {
      entry: ['scripts/**/*.{ts,js,mjs}'],
      ignoreDependencies: ['vite'],
      ignoreBinaries: ['llvm-symbolizer'],
    },
    'packages/bases': {},
    'packages/chats': {},
    'packages/editor': { ignoreDependencies: ['turndown'] },
    'packages/glasses': {},
    'packages/markdown': {},
    'packages/online': {},
    'packages/pass': {
      ignoreBinaries: ['ssh-keygen'],
    },
    'packages/rooms': {},
    'packages/scan': {},
    'packages/sync-core': {},
    'apps/desktop': {
      entry: [
        'src/**/*.even.ts',
        'index.html',
        'even.html',
        'src/even.ts',
        'presenter.html',
        'src/presenter.ts',
        'quick-add.html',
        'src/quick-add.ts',
        'handoff.html',
        'src/handoff.ts',
        'pass-link.html',
        'src/pass-link.ts',
        'pass.html',
        'src/pass-web.ts',
        'src/lib/pass/test-device.ts',
        'src/site/site.ts',
        'src/lib/ai/review/index.ts',
        'src/lib/chats/providers/node/*.ts',
      ],
      ignoreDependencies: ['katex', 'axe-core', 'buffer', 'events'],
      ignoreBinaries: ['jq'],
    },
    'apps/cli': {
      ignoreBinaries: ['screencapture', 'osascript'],
    },
    'services/sync': {
      entry: ['src/machines/entry.ts'],
      ignoreDependencies: ['cloudflare'],
    },
    'services/machine': {
      entry: ['src/main.ts', 'src/hold.ts', 'vitest.image.config.ts', 'test/**/*.drive.ts'],
    },
    'packages/themes': {},
  },
} satisfies KnipConfig
