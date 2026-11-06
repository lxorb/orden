import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const SKIPPED = new Set([
  'node_modules',
  'target',
  '.git',
  '.wrangler',
  '.svelte-kit',
  'graphify-out',
  'docs',
  'patches',
  'shots',
  'tauri-runtime-cef',
  'wry',
])

const NOT_OURS = [
  /(^|\/)dist[^/]*\//,
  /^apps\/desktop\/src-tauri\/gen\/(?!android\/)/,
  /^apps\/desktop\/src-tauri\/gen\/android\/gradlew/,
  /\/fixtures\/[^/]+\.html$/,
  /^apps\/desktop\/src-tauri\/linux\/Cargo\.toml$/,
]

const LATER = new Set([
  'apps/desktop/test/e2e/access.py',
  'apps/desktop/test/e2e/address-kept.py',
  'apps/desktop/test/e2e/agents-md.py',
  'apps/desktop/test/e2e/agents-settings.py',
  'apps/desktop/test/e2e/alt-numbers-follow.py',
  'apps/desktop/test/e2e/chats-live.py',
  'apps/desktop/test/e2e/ctrl-t-web-notes.py',
  'apps/desktop/test/e2e/deck-keys.py',
  'apps/desktop/test/e2e/note-sides.py',
  'apps/desktop/test/e2e/pen-shapes.py',
  'apps/desktop/test/e2e/profiles.py',
  'apps/desktop/test/e2e/quick-tools.py',
  'apps/desktop/test/e2e/tab-close.py',
  'apps/desktop/test/e2e/tabs-hints.py',
  'apps/desktop/test/e2e/version.py',
  'apps/desktop/test/e2e/writing-feel.py',
  'packages/themes/src/editor.css',
])

const LANGUAGES: [RegExp, (text: string) => string[]][] = [
  [/\.(rs|kt|kts|swift|gradle|jsonc)$/, slashed],
  [/\.css$/, (text) => blocks(text)],
  [
    /\.svelte$/,
    (text) =>
      [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].flatMap((one) => blocks(one[1] ?? '')),
  ],
  [
    /\.(html|xml|plist|nuspec)$/,
    (text) => [...text.matchAll(/<!--[\s\S]*?-->/g)].map((one) => one[0]),
  ],
  [/\.sql$/, dashed],
  [/\.py$/, python],
  [
    /(\.(sh|ya?ml|toml|nix|ps1|rb|properties|pro|desktop|repo)|PKGBUILD|\.gitignore|\.prettierignore|CODEOWNERS)$/,
    hashed,
  ],
]

const ALLOWED = [
  /^#!/,
  /^#\s*(noqa|type:\s*ignore|pyright:|shellcheck\s|yaml-language-server:|fmt:\s*(off|on|skip)|-\*-\s*coding)/,
  /^#\s+on (amd64|arm64): sha256\/[0-9a-f]{64}$/,
  /^# (Maintainer|Contributor):/,
]

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else if (entry.isFile()) found.push(relative(ROOT, path).split('\\').join('/'))
  }
  return found
}

function quoted(text: string, at: number, quote: string): number {
  let index = at + quote.length
  while (index < text.length && !text.startsWith(quote, index))
    index += text[index] === '\\' && quote.length === 1 ? 2 : 1
  return index + quote.length
}

function slashed(text: string): string[] {
  const found: string[] = []
  let index = 0
  while (index < text.length) {
    const rest = text.slice(index, index + 8)
    const raw = /^b?r(#*)"/.exec(rest)
    if (raw && !/\w/.test(text[index - 1] ?? '')) {
      const close = `"${raw[1] ?? ''}`
      index = text.indexOf(close, index + raw[0].length) + close.length
    } else if (text.startsWith('"""', index)) index = quoted(text, index, '"""')
    else if (text[index] === '"') index = quoted(text, index, '"')
    else if (text[index] === "'" && /^'(\\.[^']*|[^\\'])'/.test(text.slice(index, index + 12)))
      index = quoted(text, index, "'")
    else if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index)
      found.push(text.slice(index, end < 0 ? text.length : end))
      index = end < 0 ? text.length : end
    } else if (text.startsWith('/*', index)) {
      let depth = 1
      let end = index + 2
      while (end < text.length && depth) {
        if (text.startsWith('/*', end)) [depth, end] = [depth + 1, end + 2]
        else if (text.startsWith('*/', end)) [depth, end] = [depth - 1, end + 2]
        else end++
      }
      found.push(text.slice(index, end))
      index = end
    } else index++
  }
  return found
}

function blocks(text: string): string[] {
  const found: string[] = []
  let index = 0
  while (index < text.length) {
    const one = text[index] ?? ''
    if (one === '"' || one === "'") index = quoted(text, index, one)
    else if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      found.push(text.slice(index, end + 2))
      index = end + 2
    } else index++
  }
  return found
}

function dashed(text: string): string[] {
  return text.split('\n').flatMap((line) => {
    const bare = line.replace(/'(?:[^']|'')*'/g, "''")
    const at = bare.indexOf('--')
    return at < 0 ? [] : [bare.slice(at)]
  })
}

function hashed(text: string): string[] {
  const found: string[] = []
  let heredoc: string | null = null
  for (const line of text.split('\n')) {
    if (heredoc !== null) {
      if (line.trim() === heredoc) heredoc = null
      continue
    }
    const bare = line.trimStart()
    if (bare.startsWith('#')) found.push(bare)
    const unquoted = line.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""')
    heredoc = unquoted.includes('<<<')
      ? null
      : (/<<-?\s*['"]?([A-Za-z_]+)['"]?/.exec(unquoted)?.[1] ?? null)
  }
  return found
}

function python(text: string): string[] {
  const found: string[] = []
  let index = 0
  let lineStart = true
  let opened = ''
  while (index < text.length) {
    const one = text[index] ?? ''
    const prefix = /^[rRbBuUfF]{0,2}("""|'''|"|')/.exec(text.slice(index, index + 5))
    if (
      prefix &&
      !/\w/.test(text[index - 1] ?? '') &&
      (one === '"' || one === "'" || /[rRbBuUfF]/.test(one))
    ) {
      const quote = prefix[1] ?? '"'
      const end = quoted(text, index + prefix[0].length - quote.length, quote)
      if (
        lineStart &&
        quote.length === 3 &&
        /:\s*$/.test(opened) &&
        /^\s*(async\s+def|def|class)\b/.test(opened)
      )
        found.push(text.slice(index, end))
      if (lineStart && quote.length === 3 && opened === '' && !text.includes('__doc__'))
        found.push(text.slice(index, end))
      index = end
      lineStart = false
    } else if (one === '#') {
      const end = text.indexOf('\n', index)
      const comment = text.slice(index, end < 0 ? text.length : end)
      if (!(index === 0 && comment.startsWith('#!'))) found.push(comment)
      index = end < 0 ? text.length : end
    } else if (one === '\n') {
      const line = text.slice(text.lastIndexOf('\n', index - 1) + 1, index)
      if (line.trim() && !/^\s*(@|$)/.test(line)) opened = line
      lineStart = true
      index++
    } else {
      if (!/\s/.test(one)) lineStart = false
      index++
    }
  }
  return found
}

const files = walk(ROOT).filter(
  (path) => !LATER.has(path) && !NOT_OURS.some((one) => one.test(path)),
)

describe('no comments', () => {
  test('there are files to read', () => {
    expect(files.filter((path) => path.endsWith('.rs')).length).toBeGreaterThan(100)
  })

  for (const [kind, read] of LANGUAGES)
    test(`in ${String(kind)}`, () => {
      const prose = files
        .filter((path) => kind.test(path))
        .flatMap((path) =>
          read(readFileSync(join(ROOT, path), 'utf8'))
            .filter((one) => !ALLOWED.some((allowed) => allowed.test(one)))
            .map((one) => `${path}: ${one.split('\n')[0]?.slice(0, 80) ?? ''}`),
        )
      expect(prose).toEqual([])
    })
})
