export const LIBRARIES = [
  'svelte',
  'clsx',
  'lucide',
  'perfect-freehand',
  'uqr',
  '@evenrealities/even_hub_sdk',
  '@evenrealities/pretext',
  'node-emoji',
  'emojilib',
  'char-regex',
  'skin-tone',
  'unicode-emoji-modifier-base',
  'marked',
  'yaml',
  'katex',
  'turndown',
  'turndown-plugin-gfm',
  '@sindresorhus/is',
  'yjs',
  'y-protocols',
  'lib0',
  '@tauri-apps/api',
  '@tauri-apps/plugin-dialog',
  '@tauri-apps/plugin-opener',
  '@tauri-apps/plugin-process',
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  '@lezer/markdown',
  '@marijn/find-cluster-break',
  'crelt',
  'style-mod',
  'w3c-keyname',
  '@replit/codemirror-vim',
  '@replit/codemirror-vim-core',
  '@codemirror/language-data',
  '@codemirror/legacy-modes',
  '@codemirror/lang-angular',
  '@codemirror/lang-cpp',
  '@codemirror/lang-css',
  '@codemirror/lang-go',
  '@codemirror/lang-html',
  '@codemirror/lang-java',
  '@codemirror/lang-javascript',
  '@codemirror/lang-jinja',
  '@codemirror/lang-json',
  '@codemirror/lang-less',
  '@codemirror/lang-liquid',
  '@codemirror/lang-markdown',
  '@codemirror/lang-php',
  '@codemirror/lang-python',
  '@codemirror/lang-rust',
  '@codemirror/lang-sass',
  '@codemirror/lang-sql',
  '@codemirror/lang-vue',
  '@codemirror/lang-wast',
  '@codemirror/lang-xml',
  '@codemirror/lang-yaml',
  '@lezer/cpp',
  '@lezer/css',
  '@lezer/go',
  '@lezer/html',
  '@lezer/java',
  '@lezer/javascript',
  '@lezer/json',
  '@lezer/php',
  '@lezer/python',
  '@lezer/rust',
  '@lezer/sass',
  '@lezer/xml',
  '@lezer/yaml',
  '@replit/codemirror-lang-nix',
  '@replit/codemirror-lang-solidity',
  '@replit/codemirror-lang-svelte',
  'codemirror-lang-elixir',
  'codemirror-lang-hcl',
  'lezer-elixir',
]

export const PACKAGES = [
  'autocomplete',
  'bases',
  'editor',
  'glasses',
  'lang-html',
  'markdown',
  'rooms',
  'scan',
  'sync-core',
  'themes',
]

export const APP_FOLDERS = [
  'agents',
  'ai',
  'api',
  'automation',
  'back-swipe',
  'canvas',
  'crash-reports',
  'dictation',
  'downloads',
  'even',
  'export',
  'foreign',
  'glass',
  'import',
  'inbox',
  'internal',
  'mobile',
  'online',
  'overview',
  'pages',
  'palette',
  'pdf',
  'protect',
  'quick-add',
  'reading',
  'recorder',
  'reminders',
  'remote',
  'rooms',
  'rows',
  'save-place',
  'scratchpad',
  'search',
  'settings',
  'shortcuts',
  'slides',
  'sync',
  'sync2',
  'tab-fill',
  'tab-strip',
  'terminal',
  'theme-picker',
  'themes',
  'views',
  'wallpaper',
  'web',
  'web-tab',
  'workspace',
]

export function sourceOf(module: string): string | null {
  const path = module.replace(/\\/g, '/')
  if (path.startsWith('\0')) return null

  const library = path.lastIndexOf('node_modules/')
  if (library >= 0) {
    const [scope = '', name = ''] = path.slice(library + 'node_modules/'.length).split('/')
    return `library ${scope.startsWith('@') ? `${scope}/${name}` : scope}`
  }

  const ours = /^packages\/([^/]+)\//.exec(path)
  if (ours) return `package ${ours[1]}`

  const folder = /^apps\/desktop\/src\/lib\/([^/?]+)\//.exec(path)
  return folder ? `folder ${folder[1]}` : null
}

export type Part = 'catalogues' | 'code' | 'fonts' | 'styles' | 'pages'

export function partOf(file: string, catalogue: boolean): Part {
  if (file.endsWith('.js')) return catalogue ? 'catalogues' : 'code'
  if (file.endsWith('.css')) return 'styles'
  if (/\.(woff2?|ttf)$/.test(file)) return 'fonts'
  return 'pages'
}

export const BUDGETS: Record<Part, number> = {
  code: 6_214_800,
  catalogues: 1_037_000,
  styles: 293_800,
  fonts: 260_000,
  pages: 40_000,
}
