import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

const right = vi.hoisted(() => ({ shows: null as string | null, closed: 0 }))

vi.mock('../../workspace.svelte', () => ({
  workspace: {
    tabs: [],
    outside: (path: string) => !path.startsWith('/space/'),
    showRight: (what: string) => {
      right.shows = what
    },
    closeRight: () => {
      right.shows = null
      right.closed++
    },
    closePanel: () => undefined,
    activate: () => undefined,
  },
}))

const api = await import('../src/api')
const { difference, joined } = await import('../src/words')

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

function pendingOf(): string[] {
  const json = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8')) as { pending?: string[] }
  return json.pending ?? []
}

describe('the module stands on its own', () => {
  test('nothing under src reaches past a module api or a file still listed as pending', () => {
    const pending = pendingOf()
    const reaching = sources(SRC).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:from |import\()'(\.[^']*)'/g)].flatMap(
        (found) => {
          const target = resolve(dirname(file), found[1] ?? '')
          if (target.startsWith(SRC)) return []
          if (/\/[a-z-]+\/src\/api$/.test(target)) return []
          const path = ENDINGS.map((one) => target + one).find((one) => existsSync(one))
          const named = path === undefined ? target : relative(ROOT, path)
          return pending.includes(named) ? [] : [`${relative(SRC, file)}: ${found[1]}`]
        },
      ),
    )
    expect(reaching).toEqual([])
  })

  test('the api loads with the pad, the card and the sync closed, and every call is there', () => {
    for (const one of [
      api.closeScratchpad,
      api.isScratchpad,
      api.loadScratchpadCard,
      api.pad,
      api.padTab,
      api.scratchFromDrawer,
      api.toggleScratchpad,
      api.wakeScratchpad,
    ]) {
      expect(typeof one).toBe('function')
    }
    expect(api.SCRATCHPAD).toBe('Scratchpad.md')
  })
})

describe('which file is the scratchpad', () => {
  test('a Scratchpad.md outside every space, and no note of that name inside one', () => {
    expect(api.isScratchpad('/app/Scratchpad.md')).toBe(true)
    expect(api.isScratchpad('/space/Scratchpad.md')).toBe(false)
    expect(api.isScratchpad('/app/Other.md')).toBe(false)
    expect(api.isScratchpad(null)).toBe(false)
    expect(api.padTab()).toBeNull()
  })
})

describe('showing it on the right', () => {
  test('the toggle opens the side when it is hidden, and closing a hidden pad does nothing', () => {
    expect(api.shown.on).toBe(false)
    api.closeScratchpad()
    expect(right.closed).toBe(0)
    api.toggleScratchpad()
    expect(right.shows).toBe('scratchpad')
  })

  test('from the drawer it closes the side when shown and opens it when not', () => {
    api.shown.on = true
    api.scratchFromDrawer()
    expect(right.shows).toBeNull()
    api.shown.on = false
    api.scratchFromDrawer()
    expect(right.shows).toBe('scratchpad')
  })
})

describe('words added to the pad', () => {
  test('land after a blank line, end with one line break, and nothing is added for blanks', () => {
    expect(joined('first  \n', ' second ')).toBe('first\n\nsecond\n')
    expect(joined('', 'only')).toBe('only\n')
    expect(joined('kept', '   ')).toBe('kept')
  })

  test('a change is the one span between what stayed the same at both ends', () => {
    expect(difference('one two three', 'one 2 three')).toEqual({ from: 4, to: 7, insert: '2' })
    expect(difference('same', 'same')).toEqual({ from: 4, to: 4, insert: '' })
  })
})
