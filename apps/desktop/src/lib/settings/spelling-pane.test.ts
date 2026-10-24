import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The spelling pane on nib's own Chromium, which is every Linux desktop: a switch per
 *  dictionary, any number of them on, and what is on said to the engine (#771). */

const told = vi.hoisted(() => ({ lists: [] as string[][] }))

vi.mock('../spell-languages', async (original) => ({
  ...(await original<typeof import('../spell-languages')>()),
  choosable: true,
  tellEngine: (languages: string[]) => void told.lists.push([...languages]),
}))

function memoryStorage(): Storage {
  const held = new Map<string, string>()
  return {
    get length() {
      return held.size
    },
    key: (at) => [...held.keys()][at] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { modes } = await import('../modes.svelte')
const { spellingPane } = await import('./spelling-pane')
const { inForceNow } = await import('../spell-languages')

const row = (name: string) => {
  const found = spellingPane(undefined)
    .groups.flatMap((group) => group.fields)
    .find((one) => one.label === name)
  if (found?.kind !== 'switch') throw new Error(`no ${name}`)
  return found
}

beforeEach(() => {
  modes.spellLanguages = []
  told.lists = []
})

describe('the dictionaries on nib’s own Chromium', () => {
  test('are a switch apiece, the reader’s own language on to begin with', () => {
    expect(row('Deutsch').get()).toBe(false)
    expect(row('Français').get()).toBe(false)
    expect(inForceNow(modes.spellLanguages)).toHaveLength(1)
  })

  test('are on several at once, and the engine is told every one that is', () => {
    const first = inForceNow(modes.spellLanguages)[0] ?? ''
    row('Deutsch').set(true)
    row('Français').set(true)
    expect(inForceNow(modes.spellLanguages)).toEqual(
      ['de-DE', 'fr-FR', first].filter((one, at, all) => all.indexOf(one) === at).sort(),
    )
    expect(told.lists.at(-1)?.sort()).toEqual(inForceNow(modes.spellLanguages).slice().sort())
  })

  test('keep the last one on, since a checker with no language is the switch above', () => {
    row('Deutsch').set(true)
    for (const one of inForceNow(modes.spellLanguages).filter((id) => id !== 'de-DE')) {
      const name = spellingPane(undefined)
        .groups.flatMap((group) => group.fields)
        .find((field) => field.words?.includes(one))?.label
      if (name) row(name).set(false)
    }
    expect(inForceNow(modes.spellLanguages)).toEqual(['de-DE'])
    expect(row('Deutsch').locked?.()).toBe(true)
    row('Deutsch').set(false)
    expect(inForceNow(modes.spellLanguages)).toEqual(['de-DE'])
  })

  test('are written down, under their own name', () => {
    row('Svenska').set(true)
    const held = JSON.parse(localStorage.getItem('nib:modes') ?? '{}') as Record<string, unknown>
    expect(held.spellLanguages).toEqual(modes.spellLanguages)
    expect(held.spellLanguages).toContain('sv-SE')
    expect('spellLanguage' in held).toBe(false)
  })
})
