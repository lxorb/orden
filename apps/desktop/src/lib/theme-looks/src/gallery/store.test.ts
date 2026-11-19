import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../../test/disk'

function stubs() {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('document', {
    documentElement: {
      dataset: {},
      style: { setProperty: () => undefined, removeProperty: () => undefined },
    },
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '', remove: () => undefined }),
    head: { append: () => undefined, insertBefore: () => undefined },
  })
}

stubs()

const folder = vi.hoisted(() => ({ files: new Map<string, string>() }))

vi.mock('../../../platform/src/tauri', () => ({
  isDesktop: true,
  isNative: true,
  platform: () => 'linux',
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'list_themes') {
      return Promise.resolve(
        [...folder.files.keys()].map((id) => ({
          id: `file:${id}`,
          name: id,
          path: `/themes/${id}.css`,
        })),
      )
    }

    if (command === 'read_theme') {
      const id = /\/themes\/(.*)\.css$/.exec(String(args.path))?.[1] ?? ''
      return Promise.resolve(folder.files.get(id) ?? '')
    }

    if (command === 'write_theme') {
      folder.files.set(String(args.id), String(args.css))
      return Promise.resolve(`/themes/${String(args.id)}.css`)
    }

    if (command === 'remove_theme') {
      folder.files.delete(String(args.id))
      return Promise.resolve(undefined)
    }

    return Promise.resolve('')
  },
}))

const { arrange, GIVEN_THEMES, store } = await import('./store.svelte')
const { theme } = await import('../../../theme/src/theme.svelte')

function entry(patch: Record<string, unknown> = {}) {
  return {
    id: 'warm-paper',
    name: 'Warm Paper',
    author: 'Orden',
    version: '1.0.0',
    description: 'Ink on cream.',
    tags: ['light', 'warm'],
    licence: 'MIT',
    variants: ['light'],
    updated: '2026-09-07',
    palettes: { light: { '--bg': '#faf6ee' }, dark: {} },
    ...patch,
  }
}

const sheet = (colour: string) => `[data-theme='light'] { color-scheme: light; --bg: ${colour}; }`

const PAIR = `[data-theme='light'] { --bg: #fff; }
[data-theme='dark'] { --bg: #000; }`

function serving(themes: unknown[], css = sheet('#faf6ee')) {
  const asked: string[] = []

  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url)

    const body = url.endsWith('index.json') ? JSON.stringify({ themes }) : css
    return Promise.resolve(new Response(body, { status: 200 }))
  })

  return asked
}

async function installedFrom(themes = [entry()], css?: string) {
  serving(themes, css)
  await store.load()
  await store.install(themes[0] as never)
}

async function updated() {
  serving([entry({ version: '2.0.0' })], sheet('#111111'))
  await store.install(entry({ version: '2.0.0' }) as never)
}

beforeEach(() => {
  vi.unstubAllGlobals()
  stubs()

  folder.files.clear()
  theme.files = []
  theme.id = 'default'
  theme.scheme = 'system'
  store.themes = []
  store.query = ''
  store.order = 'newest'
  store.error = null
  store.refused = { id: '', notes: [] }
})

describe('what the grid shows', () => {
  const catalogue = [
    entry({ id: 'a', name: 'Zinc', updated: '2026-01-01', tags: ['dark'], description: 'Cold.' }),
    entry({
      id: 'b',
      name: 'Amber',
      updated: '2026-08-01',
      tags: ['light', 'warm'],
      description: 'Ink on cream.',
    }),
    entry({
      id: 'c',
      name: 'Mono',
      updated: '2026-08-01',
      author: 'Emil',
      tags: ['grey'],
      description: 'No hue at all.',
    }),
  ].map((one) => ({ ...one, variants: ['light' as const], palettes: { light: {}, dark: {} } }))

  const names = (query: string, order: 'newest' | 'name') => arrange(catalogue, query, order).map((one) => one.name)

  test.each([
    ['', 'newest', ['Amber', 'Mono', 'Zinc']],
    ['', 'name', ['Amber', 'Mono', 'Zinc']],
    ['mono', 'name', ['Mono']],
    ['Emil', 'name', ['Mono']],
    ['warm', 'name', ['Amber']],
    ['cream', 'name', ['Amber']],
    ['ZINC', 'name', ['Zinc']],
    ['Orden', 'newest', ['Amber', 'Zinc']],
    ['   ', 'newest', ['Amber', 'Mono', 'Zinc']],
    ['chartreuse', 'name', []],
  ] as const)(
    'searching %j by %s, the name, author, tags and text in any case, still sorted, ties by name',
    (query, order, shown) => {
      expect(names(query, order)).toEqual(shown)
      expect(catalogue.map((one) => one.id)).toEqual(['a', 'b', 'c'])
    },
  )
})

describe('the catalogue', () => {
  test('is read once and not again while it is fresh, unless asked for outright', async () => {
    const asked = serving([entry()])
    await store.load()
    await store.load()
    expect(asked).toEqual([expect.stringContaining('index.json')])
    expect(store.themes).toHaveLength(1)
    await store.load(true)
    expect(asked).toHaveLength(2)
  })

  test('has no card for a theme the app ships with', async () => {
    serving([entry(), entry({ id: 'contrast', name: 'Contrast' })])
    await store.load(true)
    expect(store.themes.map((one) => one.id)).toEqual(['warm-paper'])
  })

  test('a registry that will not answer says so and shows nothing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })))
    await store.load()
    expect(store.themes).toEqual([])
    expect(store.error).toBe('could not reach the theme store')
  })
})

describe('installing, updating and removing', () => {
  test('writes the theme, stamps it, and puts the app on it', async () => {
    serving([entry()])
    await store.load()
    expect(store.installed('warm-paper')).toBe(false)
    await store.install(entry({}) as never)
    expect(folder.files.get('warm-paper')).toContain('--bg: #faf6ee;')
    expect(folder.files.get('warm-paper')).toContain('"version":"1.0.0"')
    expect(store.installed('warm-paper')).toBe(true)
    expect(store.using('warm-paper')).toBe(true)
    expect(theme.active.name).toBe('Warm Paper')
  })

  test('a pair opens on the side the app was already showing', async () => {
    serving([entry({ variants: ['light', 'dark'] })], PAIR)
    await store.load()
    theme.setScheme('dark')
    await store.install(entry({ variants: ['light', 'dark'] }) as never)
    expect(theme.current).toBe('dark')
    expect(theme.active.variants).toEqual(['light', 'dark'])
  })

  test('a pair is switched inside itself rather than swapped for a built-in', async () => {
    serving([entry({ variants: ['light', 'dark'] })], PAIR)
    await store.load()
    theme.setScheme('light')
    await store.install(entry({ variants: ['light', 'dark'] }) as never)
    theme.toggle()
    expect(theme.current).toBe('dark')
    expect(store.using('warm-paper')).toBe(true)
    theme.toggle()
    expect(theme.current).toBe('light')
    expect(store.using('warm-paper')).toBe(true)
  })

  test('a theme that brings an accent keeps it, and one that does not lets it go', async () => {
    await installedFrom(undefined, `[data-theme='light'] { --bg: #fff; --accent: #a0522d; }`)
    expect(theme.accentIsTheme).toBe(true)
    await store.remove('warm-paper')
    expect(theme.accentIsTheme).toBe(false)
  })

  test('offers an update only when the catalogue is ahead', async () => {
    await installedFrom()
    expect(store.updatable(entry() as never)).toBe(false)
    expect(store.updatable(entry({ version: '1.0.1' }) as never)).toBe(true)
    expect(store.updatable(entry({ version: '0.9.0' }) as never)).toBe(false)
  })

  test('an update replaces the file and the version with it, keeping the app on it', async () => {
    await installedFrom()
    await updated()
    expect(folder.files.size).toBe(1)
    expect(folder.files.get('warm-paper')).toContain('--bg: #111111;')
    expect(store.updatable(entry({ version: '2.0.0' }) as never)).toBe(false)
    expect(store.using('warm-paper')).toBe(true)
  })

  test('an update to a theme not in use leaves the app on the theme it was showing', async () => {
    await installedFrom()
    theme.select('default')
    await updated()
    expect(folder.files.get('warm-paper')).toContain('--bg: #111111;')
    expect(theme.id).toBe('default')
    expect(store.using('warm-paper')).toBe(false)
  })

  test('removing takes the file away and the app off it', async () => {
    await installedFrom()
    await store.remove('warm-paper')
    expect(folder.files.size).toBe(0)
    expect(store.installed('warm-paper')).toBe(false)
    expect(store.using('warm-paper')).toBe(false)
    expect(theme.id).toBe('default')
  })

  test('removing the theme in use tells the account, so the account does not bring it back', async () => {
    await installedFrom()
    const worn = theme.look()
    let told = 0
    const stop = theme.picked(() => told++)
    await store.remove('warm-paper')
    stop()
    expect(told).toBe(1)
    expect(theme.look().theme).toBe('default')
    expect(theme.look().css).toBe('')
    expect(worn.theme).toBe('file:warm-paper')
  })

  test('what the theme asked for and did not get is kept to be said', async () => {
    await installedFrom(undefined, `${sheet('#faf6ee')}\n.sidebar { display: none; }`)
    expect(store.refused).toEqual({
      id: 'warm-paper',
      notes: ['.sidebar is not a selector a theme may set'],
    })
    expect(folder.files.get('warm-paper')).not.toContain('sidebar')
  })

  test('a theme with nothing a theme may set is not installed', async () => {
    await installedFrom(undefined, '.sidebar { display: none; }')
    expect(folder.files.size).toBe(0)
    expect(store.error).toBe('that theme has nothing a theme may set')
  })

  test('a stylesheet that will not arrive leaves the folder alone', async () => {
    serving([entry()])
    await store.load()
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })))
    await store.install(entry({}) as never)
    expect(folder.files.size).toBe(0)
    expect(store.error).toBe('could not fetch that theme')
  })

  test('a theme somebody dropped in by hand does not belong to the store', async () => {
    folder.files.set('night-owl', sheet('#001122'))
    await theme.reload()
    expect(theme.files).toHaveLength(1)
    expect(store.installed('night-owl')).toBe(false)
  })
})

describe('keeping up with the catalogue', () => {
  const given = () => GIVEN_THEMES.map((id) => entry({ id, name: id }))

  test('puts the given themes in the folder, once, and wears none of them', async () => {
    serving(given())
    await store.keepUp()
    expect([...folder.files.keys()].sort()).toEqual([...GIVEN_THEMES].sort())
    expect(GIVEN_THEMES.every((id) => store.installed(id))).toBe(true)
    expect(theme.id).toBe('default')
    await store.remove('rose')
    store.themes = []
    await store.keepUp()
    expect(folder.files.has('rose')).toBe(false)
  })

  test('writes an installed theme again at the newer version, and paints it if worn', async () => {
    await installedFrom()
    serving([entry({ version: '1.1.0' })], PAIR)
    store.themes = []
    await store.keepUp()
    expect(folder.files.get('warm-paper')).toContain('"version":"1.1.0"')
    expect(store.using('warm-paper')).toBe(true)
    expect(theme.active.variants).toEqual(['light', 'dark'])
  })

  test('leaves a theme at the catalogue version alone, and a hand-placed one too', async () => {
    await installedFrom()
    folder.files.set('night-owl', sheet('#001122'))
    const asked = serving([entry(), entry({ id: 'night-owl', name: 'Night Owl', version: '9.0.0' })])
    store.themes = []
    await store.keepUp()
    expect(asked.filter((url) => url.endsWith('theme.css'))).toEqual([])
    expect(folder.files.get('night-owl')).toBe(sheet('#001122'))
  })

  test('a catalogue that will not answer changes nothing and says nothing', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 500 })))
    await store.keepUp()
    expect(folder.files.size).toBe(0)
    expect(store.error).toBe(null)
    serving(given())
    await store.keepUp()
    expect(folder.files.size).toBe(GIVEN_THEMES.length)
  })
})

describe('the light and dark switch', () => {
  test('is live on the built-in, which states both schemes', () => {
    expect(theme.switchable).toBe(true)
    theme.setScheme('dark')
    expect(theme.switchable).toBe(true)
    theme.toggle()
    expect(theme.current).toBe('light')
  })

  test('is dead on a theme file that states one scheme, switching nothing, until it is removed', async () => {
    await installedFrom()
    expect(theme.switchable).toBe(false)
    theme.toggle()
    expect(store.using('warm-paper')).toBe(true)
    expect(theme.current).toBe('light')
    await store.remove('warm-paper')
    expect(theme.switchable).toBe(true)
  })

  test('is live on a theme file that states both', async () => {
    await installedFrom([entry({ variants: ['light', 'dark'] })], PAIR)
    expect(theme.switchable).toBe(true)
    const was = theme.current
    theme.toggle()
    expect(theme.current).not.toBe(was)
    expect(store.using('warm-paper')).toBe(true)
  })
})
