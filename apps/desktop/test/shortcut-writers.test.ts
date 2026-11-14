import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { settleShortcuts } from '@orden/scan/settle'
import { withOwn } from '../src/lib/web-tab/src/own-file'
import { readShortcut, rewriteShortcut, writeShortcut } from '@orden/scan/shortcut'

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, found)
    else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

const FRESH: Record<string, string> = {
  'lib/web-tab/src/new-site.ts': 'a website made from an address',
  'lib/web-tab/src/convert.ts': 'an old `url:` note made into a shortcut',
  'lib/agents/workspace/new-files.ts': 'a website an agent makes',
  'lib/workspace/placing.ts': 'a tab kept as a new web note, settled with any already there',
  'lib/import/src/sidebar-plan.ts': "another browser's tabs, imported",
  'lib/web-tab/src/keep.ts': 'a file that no longer reads as a shortcut, written anew',
  'lib/web-tab/src/aimed.ts': 'a file that no longer reads as a shortcut, written anew',
}

describe('a shortcut written again', () => {
  const chosen =
    '[InternetShortcut]\r\nURL=https://svelte.dev/\r\nTitle=Svelte\r\nOrden-Added=2026-01-01T00:00:00.000Z\r\n' +
    'Orden-Icon=data:image/png;base64,AA\r\nOrden-Chosen-Icon=rocket\r\nOrden-Chosen-Color=violet\r\n'

  test('keeps the icon the reader chose, and everything else it said', () => {
    const was = readShortcut(chosen)!
    expect(was.chosen).toBe('rocket')
    expect(was.chosenColour).toBe('violet')

    const moved = readShortcut(rewriteShortcut(was, { url: 'https://svelte.dev/docs' }))!
    expect(moved).toMatchObject({
      url: 'https://svelte.dev/docs',
      title: 'Svelte',
      added: '2026-01-01T00:00:00.000Z',
      icon: 'data:image/png;base64,AA',
      chosen: 'rocket',
      chosenColour: 'violet',
    })
  })

  test('and takes it away only when asked, with its colour', () => {
    const reset = readShortcut(rewriteShortcut(readShortcut(chosen)!, { chosen: null }))!
    expect(reset.chosen).toBeNull()
    expect(reset.chosenColour).toBeNull()
    expect(reset.icon).toBe('data:image/png;base64,AA')
  })

  test('through every writer of a file that is there', () => {
    expect(readShortcut(withOwn('Svelte.url', chosen, '0123456789abcdef'))?.chosen).toBe('rocket')

    const newer = writeShortcut('https://svelte.dev/blog', 'Svelte', new Date())
    const settled = readShortcut(settleShortcuts('Svelte.url', chosen, newer, true))!
    expect(settled.url).toBe('https://svelte.dev/blog')
    expect(settled.chosen).toBe('rocket')
  })

  test('is never written from its parts but where that is the point', () => {
    const writers = files(SOURCE)
      .filter((path) => /\bwriteShortcut\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SOURCE, path).replace(/\\/g, '/'))
      .sort()

    expect(writers).toEqual(Object.keys(FRESH).sort())
  })
})
