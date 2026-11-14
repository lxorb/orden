import { describe, expect, test, vi } from 'vitest'

let asked: string[] = []

vi.mock('./icon-sets', () => {
  const held = (id: string) => ({
    entries: [{ name: `${id}-one`, words: 'one' }],
    groups: [],
    shape: (name: string) => (name === `${id}-one` ? { kind: 'stroked' as const, icon: [] } : null),
  })

  return {
    DEFAULT_SET: 'lucide',
    FLAT_COLOUR: 'flat-color-icons',
    ICON_SETS: [],
    setNamed: (id: string) => {
      if (id === 'nothing-here') return null

      return {
        id,
        label: id,
        credit: '',
        load: async () => {
          asked.push(id)
          if (id === 'refuses') throw new Error('not in this build')
          return held(id)
        },
      }
    },
  }
})

vi.mock('./ui-kit/src/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ui-kit/src/icons')>()),
  loadIcons: async () => ({ Rocket: [['path', { d: 'M4 20l6-6' }]] }),
}))

const { iconLibrary } = await import('./icon-library.svelte')
const { startup } = await import('./startup.svelte')

void startup.shown()

const settled = async () => {
  for (let round = 0; round < 8; round++) await new Promise((done) => setTimeout(done, 0))
}

describe('asking for a set', () => {
  test('fetches it once however often it is asked for', async () => {
    asked = []
    iconLibrary.load('flat-color-icons')
    iconLibrary.load('flat-color-icons')
    iconLibrary.load('flat-color-icons')
    await settled()

    expect(asked.filter((one) => one === 'flat-color-icons')).toHaveLength(1)
    expect(iconLibrary.loaded['flat-color-icons']).toBeDefined()
  })

  test('is not loading once it has arrived', async () => {
    asked = []
    iconLibrary.load('another')
    expect(iconLibrary.loading('another')).toBe(true)

    await settled()
    expect(iconLibrary.loading('another')).toBe(false)
  })

  test('a set that will not load is absent rather than loading', async () => {
    asked = []
    iconLibrary.load('refuses')
    await settled()

    expect(iconLibrary.absent.refuses).toBe(true)
    expect(iconLibrary.loading('refuses')).toBe(false)
  })

  test('and a set nothing here knows is never asked for at all', async () => {
    asked = []
    iconLibrary.load('nothing-here')
    await settled()

    expect(asked).toEqual([])
    expect(iconLibrary.loading('nothing-here')).toBe(false)
    expect(iconLibrary.absent['nothing-here']).toBeUndefined()
  })
})

describe('what to draw for a written icon', () => {
  test('an emoji needs no set at all', () => {
    expect(iconLibrary.drawing({ kind: 'emoji', text: '🚀' })).toEqual({
      kind: 'emoji',
      text: '🚀',
    })
    expect(iconLibrary.setFor({ kind: 'emoji', text: '🚀' })).toBeNull()
  })

  test('a line icon comes out of the stroked set, in any spelling', async () => {
    iconLibrary.load()
    await settled()

    expect(iconLibrary.drawing({ kind: 'lucide', name: 'rocket' })?.kind).toBe('stroked')
    expect(iconLibrary.drawing({ kind: 'lucide', name: 'LiRocket' })?.kind).toBe('stroked')
    expect(iconLibrary.setFor({ kind: 'lucide', name: 'rocket' })).toBe('lucide')
  })

  test('and one out of another set says which set it needs', () => {
    const icon = { kind: 'set', set: 'flat-color-icons', name: 'flat-color-icons-one' } as const
    expect(iconLibrary.setFor(icon)).toBe('flat-color-icons')
  })

  test('nothing chosen is nothing to draw', () => {
    expect(iconLibrary.drawing(null)).toBeNull()
    expect(iconLibrary.setFor(null)).toBeNull()
  })

  test('and a name no set holds is nothing to draw either', () => {
    expect(iconLibrary.drawing({ kind: 'lucide', name: 'not-an-icon-anybody-drew' })).toBeNull()
    expect(iconLibrary.drawing({ kind: 'set', set: 'never-loaded', name: 'thing' })).toBeNull()
  })
})
