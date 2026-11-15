import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  type Across,
  draftFile,
  hasWords,
  holdsWords,
  isDraft,
  meetAcross,
  NoteDoc,
  oweTo,
  Tab,
  unixLines,
  writeEdited,
} from '../src/api'

const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
const ROOT = join(HERE, '../../../../..')
const ENDINGS = ['', '.ts', '.svelte.ts', '.svelte', '/index.ts']

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|svelte)$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

const note = (text: string, path: string | null = null) =>
  new NoteDoc({ kind: 'note', path, name: 'Untitled', text, dirty: false }, () => undefined)

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api, and no workspace file at all', () => {
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          return [`${relative(SRC, file)}: ${path === undefined ? target : relative(ROOT, path)}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })
})

describe('an open document', () => {
  test('a draft holds words of its own and no file, and its file is named by them', () => {
    expect(isDraft(note('# Plan\n'))).toBe(true)
    expect(isDraft(note('# Plan\n', '/s/Plan.md'))).toBe(false)
    expect(hasWords(note(' \n'))).toBe(false)
    expect(draftFile(note('# Plan\n'))).toBe('Plan.md')
  })

  test('a tab shows one document in one pane, and only some kinds hold words', () => {
    const tab = new Tab(note('words'), 'pane')
    expect(tab.paneId).toBe('pane')
    expect(tab.note.text).toBe('words')
    expect(holdsWords('note')).toBe(true)
    expect(holdsWords('terminal')).toBe(false)
    expect(unixLines('a\r\nb\rc')).toBe('a\nb\nc')
  })

  test('words go through sync while it writes across, and a write that fails before is owed', async () => {
    const owed: string[] = []
    oweTo((one) => owed.push(one.text))
    const through: string[] = []
    const across: Across = {
      wroteHere: () => undefined,
      owe: (one) => owed.push(`across ${one.text}`),
      writing: (one, path) => {
        through.push(path)
        return Promise.resolve({ words: one.text, revision: one.revision })
      },
    }
    meetAcross(across)
    const doc = note('words', '/s/Plan.md')
    expect(await writeEdited(doc, '/s/Plan.md', 'words', null)).toBe('words')
    expect(through).toEqual(['/s/Plan.md'])
    expect(doc.dirty).toBe(false)
    meetAcross(null)
    const refused = await writeEdited(doc, '/s/Plan.md', 'words', null, () =>
      Promise.reject(new Error('locked')),
    )
    expect(refused).toBeNull()
    expect(owed).toEqual(['words'])
  })
})
