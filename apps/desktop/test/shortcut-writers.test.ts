import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { settleShortcuts } from '../src/lib/web-tab/settle'
import { withOwn } from '../src/lib/web-tab/own-file'
import { readShortcut, rewriteShortcut, writeShortcut } from '../src/lib/web-tab/shortcut'

/** Every `.url` the app writes again keeps what it said (#1098).
 *
 *  A web note's file is rewritten all the time - the page moves on, the site's mark
 *  changes, its own web data is turned on, two copies are settled - and each of those
 *  used to build the file afresh from the fields it knew about. A key one writer had
 *  never heard of was dropped by the next, which for the icon the reader chose would be
 *  the icon quietly going back to the site's. So a file that is there is written again
 *  through `rewriteShortcut`, which starts from what it says, and `writeShortcut` is for
 *  a file that is not there yet. The second half holds the app to that: a new place
 *  that writes a shortcut from its parts is a decision, written down below. */

const SOURCE = fileURLToPath(new URL('../src', import.meta.url))

function files(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, found)
    else if (/\.(ts|svelte)$/.test(name) && !name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

/** The modules that write a shortcut from its parts, and why each may. */
const FRESH: Record<string, string> = {
  'lib/web-tab/shortcut.ts': 'where both are defined',
  'lib/web-tab/new-site.ts': 'a website made from an address',
  'lib/web-tab/convert.ts': 'an old `url:` note made into a shortcut',
  'lib/agents/workspace/new-files.ts': 'a website an agent makes',
  'lib/workspace/placing.ts': 'a tab kept as a new web note, settled with any already there',
  'lib/import/sidebar-plan.ts': "another browser's tabs, imported",
  'lib/web-tab/keep.ts': 'a file that no longer reads as a shortcut, written anew',
  'lib/web-tab/aimed.ts': 'a file that no longer reads as a shortcut, written anew',
}

describe('a shortcut written again', () => {
  const chosen =
    '[InternetShortcut]\r\nURL=https://svelte.dev/\r\nTitle=Svelte\r\nNib-Added=2026-01-01T00:00:00.000Z\r\n' +
    'Nib-Icon=data:image/png;base64,AA\r\nNib-Chosen-Icon=rocket\r\nNib-Chosen-Color=violet\r\n'

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

    // Two copies settled: the choice survives a newer copy written before it was heard of.
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
