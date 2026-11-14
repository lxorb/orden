import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import {
  busy,
  Cross,
  DIVIDER,
  initial,
  isSubmenu,
  matchesCombination,
  message,
  opensAt,
  parseCombination,
  prompt,
  rank,
  readIcon,
  sameCombination,
  sameIcon,
  showCombination,
  walk,
  walkableRows,
  writtenIcon,
} from '../src/api'
import { deviceFor } from '../src/viewport.svelte'
import { fuzzy } from '../src/fuzzy'
import { words } from '../src/icons'

const SRC = join(import.meta.dirname, '../src')

describe('the module stands on its own', () => {
  test('nothing under src reaches past the platform and theme apis', () => {
    const reaching = readdirSync(SRC)
      .filter((name) => !name.includes('.test.'))
      .flatMap((name) => {
        const text = readFileSync(join(SRC, name), 'utf8')
        return [...text.matchAll(/'(\.\.\/[^']*)'/g)]
          .map((found) => found[1] ?? '')
          .filter((spec) => !/^\.\.\/\.\.\/(?:platform|theme)\/src\/api$/.test(spec))
          .map((spec) => `${name}: ${spec}`)
      })
    expect(reaching).toEqual([])
  })

  test('the components and the prompt are there to call', () => {
    expect(typeof Cross).toBe('function')
    expect(typeof prompt.ask).toBe('function')
    expect(typeof busy.run).toBe('function')
  })
})

describe('words for the reader', () => {
  test('an error speaks for itself unless it is a TypeError or has nothing to say', () => {
    expect(message(new Error('Disk full'), 'Could not save.')).toBe('Disk full')
    expect(message(new TypeError('x is not a function'), 'Could not save.')).toBe('Could not save.')
    expect(message(new Error(''), 'Could not save.')).toBe('Could not save.')
    expect(message('text', 'Could not save.')).toBe('Could not save.')
  })

  test('a name has an initial and its words', () => {
    expect(initial('notes')).toBe('N')
    expect(initial('')).toBe('·')
    expect(words('fileTextIcon')).toBe('file text icon')
    expect(words('PDFReader')).toBe('pdf reader')
  })
})

describe('keys', () => {
  test('a combination is read the same whichever way it is spelled', () => {
    expect(sameCombination('Mod-Shift-K', 'shift-mod-k', 'mac')).toBe(true)
    expect(parseCombination('', 'mac')).toBeNull()
    expect(showCombination('Mod-K', 'mac')).not.toBe(showCombination('Mod-K', 'win'))
  })

  test('a keystroke matches only its own combination, never while composing', () => {
    const press = {
      key: 'k',
      code: 'KeyK',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    }
    expect(matchesCombination('Mod-K', press, 'mac')).toBe(true)
    expect(matchesCombination('Mod-K', { ...press, metaKey: false, ctrlKey: true }, 'win')).toBe(
      true,
    )
    expect(matchesCombination('Mod-J', press, 'mac')).toBe(false)
    expect(matchesCombination('Mod-K', { ...press, isComposing: true }, 'mac')).toBe(false)
  })

  test('arrow keys walk a list and typed letters jump to a label', () => {
    const labels = ['Apple', 'Banana', 'Cherry']
    const down = walk('ArrowDown', 0, labels, opensAt(-1))
    expect(down.took).toBe(true)
    expect(down.walk.cursor).toBe(0)
    const typed = walk('c', 0, labels, opensAt(0))
    expect(typed.took).toBe(true)
    expect(typed.walk.cursor).toBe(2)
    expect(walk('x', 0, [], opensAt(0)).took).toBe(false)
  })
})

describe('menus and lists', () => {
  test('a menu is walked past its dividers and disabled rows', () => {
    const rows = [
      { label: 'Open', run: () => undefined },
      DIVIDER,
      { label: 'Gone', disabled: true, run: () => undefined },
      { label: 'More', rows: [] },
    ]
    expect(walkableRows(rows)).toEqual([0, 3])
    expect(isSubmenu(rows[3] ?? DIVIDER)).toBe(true)
    expect(isSubmenu(rows[0] ?? DIVIDER)).toBe(false)
  })

  test('fuzzy ranking puts the closest name first and drops what does not match', () => {
    expect(fuzzy('', 'anything')).toBe(0)
    expect(fuzzy('zzz', 'notes')).toBeNull()
    const ranked = rank('not', ['Scratch', 'Notes', 'Nothing here'], (one) => one)
    expect(ranked[0]).toBe('Notes')
    expect(ranked).not.toContain('Scratch')
  })
})

describe('icons', () => {
  test('an icon is read back as what was written, and compared by meaning', () => {
    expect(readIcon('🍎')).toEqual({ kind: 'emoji', text: '🍎' })
    expect(readIcon(writtenIcon('brands', 'github'))).toEqual({
      kind: 'set',
      set: 'brands',
      name: 'github',
    })
    expect(readIcon('  ')).toBeNull()
    expect(sameIcon('🍎', '🍎')).toBe(true)
    expect(sameIcon('🍎', '🍐')).toBe(false)
    expect(sameIcon(null, '🍎')).toBe(false)
  })
})

describe('the viewport', () => {
  test('a device is a phone by its shorter side, a desktop by its machine', () => {
    const phone = { native: true, handheld: true, agent: 'iPhone', finger: true }
    expect(deviceFor(390, 844, phone)).toBe('phone')
    expect(deviceFor(1024, 1366, phone)).toBe('tablet')
    expect(
      deviceFor(390, 844, { native: false, handheld: null, agent: 'X11', finger: false }),
    ).toBe('desktop')
  })

  test('busy work is counted and told, and a failure is shown', async () => {
    const ran = vi.fn(() => Promise.resolve(7))
    expect(await busy.run('Saving', ran)).toBe(7)
    expect(ran).toHaveBeenCalledTimes(1)
    busy.failed('Could not save.')
    expect(busy.trouble).toBe('Could not save.')
    busy.clear()
    expect(busy.trouble).toBeNull()
  })
})
