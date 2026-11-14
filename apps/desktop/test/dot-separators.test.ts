import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const PLACES = ['apps/desktop/src/', 'packages/', 'services/sync/src/', 'services/machine/src/']
const EXTENSIONS = ['.ts', '.svelte', '.css', '.html', '.js']
const NOT_SHOWN = [/\.test\.ts$/, /\.fixture\.ts$/, /\/fixtures\//, /\/test\//, /\.d\.ts$/]

const DOTS = /[\u00b7\u2022\u2219\u2027\u30fb\u22c5]|\\u00b7|\\u2022|&middot;|&bull;/iu

const ALLOWED: readonly { path: string; holds: string; why: string }[] = [
  {
    path: 'apps/desktop/src/lib/toolbar.svelte.ts',
    holds: "'paragraph.bullet-list'",
    why: 'the bullet list button draws a bullet',
  },
  {
    path: 'apps/desktop/src/lib/canvas/picture.ts',
    holds: '[-*+]',
    why: 'a markdown list item drawn with its bullet',
  },
  {
    path: 'apps/desktop/src/lib/pages/laid.ts',
    holds: 'ordered ?',
    why: 'the marker of an unordered list item',
  },
  {
    path: 'apps/desktop/src/lib/quick-add/src/field.ts',
    holds: '[-*+',
    why: 'pasted list markers are stripped',
  },
  {
    path: 'packages/glasses/src/mark.ts',
    holds: 'const BULLETS',
    why: 'list markers the glasses read',
  },
  {
    path: 'packages/glasses/src/firmware.ts',
    holds: "': '",
    why: 'glyphs the glasses font lacks, mapped to ones it has',
  },
  {
    path: 'apps/desktop/src/lib/export/src/document.ts',
    holds: "['bull'",
    why: 'the RTF bullet control word',
  },
  {
    path: 'apps/desktop/src/lib/export/src/omml.ts',
    holds: "'\\\\cdot'",
    why: 'the TeX multiplication dot',
  },
  { path: 'apps/desktop/src/lib/import/src/sources.ts', holds: "'", why: 'a code page table' },
  {
    path: 'apps/desktop/src/lib/ui-kit/src/icons.ts',
    holds: "first === undefined ? '",
    why: 'the mark of a nameless thing, alone',
  },
  {
    path: 'apps/desktop/src/lib/publishing/src/PublishSheet.svelte',
    holds: 'publish.hasPassword ?',
    why: 'a hidden password',
  },
  {
    path: 'apps/desktop/src/lib/pass-ui/src/FieldRow.svelte',
    holds: 'const dots',
    why: 'a hidden secret',
  },
  {
    path: 'apps/desktop/src/lib/pass-ui/src/TotpRow.svelte',
    holds: '{shown ||',
    why: 'a hidden code',
  },
  {
    path: 'apps/desktop/src/lib/pass-links/src/link-page.ts',
    holds: 'const MASK',
    why: 'a hidden secret',
  },
  {
    path: 'apps/desktop/src/lib/pass-sync/src/list.ts',
    holds: 'four ?',
    why: 'the hidden digits of a card number',
  },
  {
    path: 'packages/chats/src/agent.ts',
    holds: '',
    why: 'words written for AI agents, never shown in the app',
  },
]

function sources(): string[] {
  const listed = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return listed
    .split('\0')
    .filter((path) => PLACES.some((place) => path.startsWith(place)))
    .filter((path) => EXTENSIONS.some((extension) => path.endsWith(extension)))
    .filter((path) => !NOT_SHOWN.some((pattern) => pattern.test(path)))
    .filter((path) => existsSync(join(ROOT, path)))
}

describe('pieces of text are set apart by layout', () => {
  const found = sources().flatMap((path) =>
    readFileSync(join(ROOT, path), 'utf8')
      .split('\n')
      .flatMap((line, at) => (DOTS.test(line) ? [{ path, line, at: at + 1 }] : [])),
  )

  test('never by a middle dot or a bullet', () => {
    const wrong = found
      .filter(
        ({ path, line }) => !ALLOWED.some((one) => one.path === path && line.includes(one.holds)),
      )
      .map(({ path, line, at }) => `${path}:${String(at)}: ${line.trim()}`)
    expect(wrong).toEqual([])
  })

  test('each allowed dot is still there', () => {
    const stale = ALLOWED.filter(
      (one) => !found.some(({ path, line }) => one.path === path && line.includes(one.holds)),
    ).map((one) => one.path)
    expect(stale).toEqual([])
  })
})
