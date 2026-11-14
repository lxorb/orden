import { beforeEach, describe, expect, test, vi } from 'vitest'

interface World {
  here: string
  asked: string[]
  answer: { ok: true; value: unknown } | { ok: false; error: string }
  went: string[]
  said: string[]
}

const world = vi.hoisted((): World => ({
  here: 'https://orden.example/',
  asked: [],
  answer: { ok: true, value: {} },
  went: [],
  said: [],
}))

vi.stubGlobal('window', {
  location: {
    get href() {
      return world.here
    },
  },
  history: { replaceState: () => undefined },
})

vi.mock('./verbs', async () => {
  const real = await vi.importActual<typeof import('./verbs')>('./verbs')

  return {
    ...real,
    dispatch: (verb: string) => {
      world.asked.push(verb)
      return Promise.resolve(world.answer)
    },
  }
})

vi.mock('../platform/src/tauri', () => ({
  isNative: false,
  isDesktop: false,
  invoke: () => Promise.resolve(null),
  openExternal: (url: string) => {
    world.went.push(url)
    return Promise.resolve()
  },
}))

vi.stubGlobal('localStorage', {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
} satisfies Storage)
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const { startAutomation } = await import('./start')

const { busy } = await import('../ui-kit/src/busy.svelte')
vi.spyOn(busy, 'failed').mockImplementation((words: string) => {
  world.said.push(words)
})

async function arrives(uri: string, query = 'orden'): Promise<void> {
  const at = new URL('https://orden.example/')
  at.searchParams.set(query, uri)
  world.here = at.href

  await startAutomation()
}

const BACK = 'https://elsewhere.example/done'

beforeEach(() => {
  world.asked = []
  world.went = []
  world.said = []
  world.answer = { ok: true, value: {} }
})

describe('a link a browser hands over', () => {
  test('is followed under the name it registered before the rename too', async () => {
    world.answer = { ok: true, value: { path: 'reading/Divorce.md', heading: null } }
    await arrives('web+nib://open?path=Divorce', 'nib')

    expect(world.asked).toEqual(['open'])
  })
})

describe('a link that changed nothing', () => {
  test('tells the address it carries nothing at all', async () => {
    world.answer = { ok: true, value: { path: 'reading/Divorce.md', heading: null } }
    await arrives(`orden://open?path=Divorce&x-success=${encodeURIComponent(BACK)}`)

    expect(world.asked).toEqual(['open'])
    expect(world.went).toEqual([])
  })

  test('and tells it nothing when the note was not there either', async () => {
    world.answer = { ok: false, error: 'there is no note at reading/Divorce.md' }
    await arrives(`orden://open?path=Divorce&x-error=${encodeURIComponent(BACK)}`)

    expect(world.went).toEqual([])
    expect(world.said.length).toBe(1)
  })

  test('which is also true of a search and of a command', async () => {
    world.answer = { ok: true, value: { query: 'tag:#work', running: false } }
    await arrives(`orden://search?query=tag:%23work&x-success=${encodeURIComponent(BACK)}`)

    world.answer = { ok: true, value: { id: 'save', ran: true } }
    await arrives(`orden://command?id=save&x-success=${encodeURIComponent(BACK)}`)

    expect(world.asked).toEqual(['search', 'commands.run'])
    expect(world.went).toEqual([])
  })

  test('and of a chain, so nothing gets out by pointing back at the app', async () => {
    world.answer = { ok: true, value: { path: 'reading/Divorce.md' } }
    const inner = `orden://open?x-success=${encodeURIComponent(BACK)}`
    await arrives(`orden://open?path=Divorce&x-success=${encodeURIComponent(inner)}`)

    expect(world.asked).toEqual(['open'])
    expect(world.went).toEqual([])
  })
})

describe('a link that made a note', () => {
  test('hears where it went, which is what the caller asked for', async () => {
    world.answer = { ok: true, value: { path: 'inbox/Idea.md', created: true } }
    await arrives(`orden://new?name=Idea&x-success=${encodeURIComponent(BACK)}`)

    expect(world.asked).toEqual(['new'])
    expect(world.went.length).toBe(1)

    const said = new URL(world.went[0] ?? '').searchParams
    expect(said.get('path')).toBe('inbox/Idea.md')
    expect(said.get('created')).toBe('true')
  })

  test('and hears why it did not', async () => {
    world.answer = { ok: false, error: 'Idea.md is already there: say append or prepend' }
    await arrives(`orden://new?name=Idea&x-error=${encodeURIComponent(BACK)}`)

    expect(new URL(world.went[0] ?? '').searchParams.get('error')).toContain('already there')
  })
})

describe('a link that added to a note', () => {
  test('is followed, and says whether the note was there already', async () => {
    world.answer = { ok: true, value: { path: 'Daily.md', added: true } }
    await arrives(
      `orden://append?path=Daily.md&content=A%20line.&x-success=${encodeURIComponent(BACK)}`,
    )

    expect(world.asked).toEqual(['append'])

    const said = new URL(world.went[0] ?? '').searchParams
    expect(said.get('path')).toBe('Daily.md')
    expect(said.get('added')).toBe('true')
  })
})

describe('a link the app will not take at all', () => {
  test('is declined to its face, which says nothing about any space', async () => {
    await arrives(`orden://files.delete?path=x&x-cancel=${encodeURIComponent(BACK)}`)

    expect(world.asked).toEqual([])
    expect(new URL(world.went[0] ?? '').searchParams.get('error')).toBe(
      'not something a link may ask for',
    )
  })

  test('and one naming nothing is simply wrong', async () => {
    await arrives(`orden://nonsense?x-error=${encodeURIComponent(BACK)}`)

    expect(new URL(world.went[0] ?? '').searchParams.get('error')).toBe('no action called nonsense')
  })
})

describe('a file handed over beside the links', () => {
  test('is left to the files road without a word', async () => {
    await arrives('file:///Users/me/Notes/Idea.md')

    expect(world.asked).toEqual([])
    expect(world.said).toEqual([])
  })
})
