import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The theme and the scheme, which are two choices and not one.
 *
 *  A theme has a dark side or a light one or both; which of them the app is
 *  showing is a choice beside it. These are about that separation: what the
 *  dropdown offers, what the scheme is when the theme in force cannot show the one
 *  that was asked for, what an older device's storage means, and what happens to
 *  the list when the themes folder will not answer.
 *
 *  Run against the real store with the folder, the storage and the page stood in
 *  for: under node there is none of the three. */

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

let kept = memoryStorage()

/** What the system is asking for, and whoever asked to be told when it changes. */
const media = { light: false, listeners: [] as ((event: { matches: boolean }) => void)[] }

/** The system changes its mind, which is what following it has to notice. */
function systemPrefers(light: boolean) {
  media.light = light
  for (const listener of media.listeners) listener({ matches: light })
}

function stubs() {
  kept = memoryStorage()
  media.light = false
  media.listeners = []

  vi.stubGlobal('localStorage', kept)
  vi.stubGlobal('window', {
    matchMedia: () => ({
      get matches() {
        return media.light
      },
      addEventListener: (_name: string, listener: (event: { matches: boolean }) => void) =>
        void media.listeners.push(listener),
    }),
  })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
  vi.stubGlobal('document', {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: { setProperty: () => undefined, removeProperty: () => undefined },
    },
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '', remove: () => undefined }),
    head: { append: () => undefined, insertBefore: () => undefined },
  })
}

stubs()

/** The themes folder, as the commands see it, and whether reading it works at
 *  all: a browser that refuses storage and a page asking for a chunk that is no
 *  longer served both come back here as a rejection. */
const folder = vi.hoisted(() => ({
  files: new Map<string, string>(),
  listing: true,
  reading: true,
}))

vi.mock('./tauri', () => ({
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'list_themes') {
      if (!folder.listing) return Promise.reject(new Error('no such folder'))

      return Promise.resolve(
        [...folder.files.keys()].map((id) => ({
          id: `file:${id}`,
          name: id,
          path: `/themes/${id}.css`,
        })),
      )
    }

    if (command === 'read_theme') {
      if (!folder.reading) return Promise.reject(new Error('cannot read'))

      const id = /\/themes\/(.*)\.css$/.exec(String(args.path))?.[1] ?? ''
      return Promise.resolve(folder.files.get(id) ?? '')
    }

    return Promise.resolve('')
  },
}))

vi.mock('./insets', () => ({ tintSystemBars: () => undefined }))

const { theme } = await import('./theme.svelte')
const { stamped } = await import('./themes/validate')

/** A theme that states both schemes, and one that states a single one. */
const PAIR = `[data-theme=light] { --bg: #fff; }\n[data-theme=dark] { --bg: #000; }`
const ONLY_LIGHT = `[data-theme=light] { color-scheme: light; --bg: #fff; }`

function installed(id: string, name: string, css: string, version = '1.0.0') {
  folder.files.set(id, stamped({ id, name, author: 'Nib', version }, css))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  stubs()

  folder.files.clear()
  folder.listing = true
  folder.reading = true
  theme.files = []
  theme.id = 'default'
  theme.scheme = 'system'
})

describe('what the dropdown offers', () => {
  test('is one built-in theme named Default, and then what is installed', async () => {
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()

    expect(theme.all.map((one) => one.id)).toEqual(['default', 'file:rose', 'file:warm-paper'])
    expect(theme.all[0]?.name).toBe('Default')
  })

  test('and never a Dark or a Light, which were the scheme wearing a theme name', async () => {
    await theme.reload()

    expect(theme.all.map((one) => one.id)).not.toContain('dark')
    expect(theme.all.map((one) => one.id)).not.toContain('light')
    expect(theme.all).toHaveLength(1)
  })

  test('the built-in carries both schemes, so it is one theme and not two', () => {
    expect(theme.active.variants).toEqual(['dark', 'light'])
    expect(theme.switchable).toBe(true)
  })
})

describe('the scheme, which is not a theme', () => {
  test('follows the system until something says otherwise, and keeps following it', () => {
    theme.init()

    expect(theme.scheme).toBe('system')
    expect(theme.current).toBe('dark')

    systemPrefers(true)
    expect(theme.current).toBe('light')
  })

  test('stops following it once one of the two is asked for', () => {
    theme.init()
    theme.setScheme('dark')

    systemPrefers(true)
    expect(theme.current).toBe('dark')
  })

  test('is not touched by choosing a theme', async () => {
    theme.init()
    theme.setScheme('light')
    installed('rose', 'Rose', PAIR)
    await theme.reload()

    theme.select('file:rose')

    expect(theme.id).toBe('file:rose')
    expect(theme.scheme).toBe('light')
    expect(theme.current).toBe('light')
  })

  test('is written down under a key of its own, so it travels beside the theme', () => {
    theme.init()
    theme.setScheme('dark')

    expect(kept.getItem('nib:theme')).toBe('default')
    expect(kept.getItem('nib:theme-scheme')).toBe('dark')
  })
})

describe('a theme with one scheme', () => {
  test('shows the scheme it has, whatever was asked for', async () => {
    theme.init()
    theme.setScheme('dark')
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()

    theme.select('file:warm-paper')

    expect(theme.current).toBe('light')
    // The choice itself is untouched, so the theme it was made for still has it.
    expect(theme.scheme).toBe('dark')
  })

  test('offers neither the other scheme nor the system, which would ask for it', async () => {
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    theme.select('file:warm-paper')

    expect(theme.offers('light')).toBe(true)
    expect(theme.offers('dark')).toBe(false)
    expect(theme.offers('system')).toBe(false)
  })

  test('leaves the control pointing at the scheme it has and not at one it lacks', async () => {
    theme.init()
    theme.setScheme('dark')
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()

    theme.select('file:warm-paper')
    expect(theme.shown).toBe('light')

    // And the choice comes back with a theme that can honour it.
    theme.select('default')
    expect(theme.shown).toBe('dark')
  })

  test('refuses a scheme it cannot show rather than showing ours instead', async () => {
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    theme.select('file:warm-paper')

    theme.setScheme('dark')

    expect(theme.current).toBe('light')
    expect(theme.id).toBe('file:warm-paper')
  })

  test('is not switched by the panel foot, which has nowhere to switch it to', async () => {
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    theme.select('file:warm-paper')

    expect(theme.switchable).toBe(false)
    theme.toggle()

    expect(theme.current).toBe('light')
    expect(theme.id).toBe('file:warm-paper')
  })
})

describe('the switch in the panel foot', () => {
  test('flips the scheme and leaves the theme where it is', async () => {
    theme.init()
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')

    const was = theme.current
    theme.toggle()

    expect(theme.current).not.toBe(was)
    expect(theme.id).toBe('file:rose')
  })

  test('turns following the system into a choice, since that is what a press is', () => {
    theme.init()
    expect(theme.scheme).toBe('system')

    theme.toggle()

    expect(theme.scheme).toBe('light')
  })
})

/** Dark, Light and Match the system were rows in the theme dropdown, and the
 *  side of a theme that stated both was kept on its own. Every one of those means
 *  the built-in theme and a scheme, and a device that has not been opened since
 *  has to come up saying what it said before. */
describe('what an older device wrote down', () => {
  test('a theme of dark means Default, in the dark', () => {
    kept.setItem('nib:theme', 'dark')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('dark')
    expect(theme.current).toBe('dark')
  })

  test('a theme of light means Default, in the light', () => {
    kept.setItem('nib:theme', 'light')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('light')
  })

  test('a theme of system means Default, following the system', () => {
    kept.setItem('nib:theme', 'system')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('system')
  })

  test('nothing written down at all means the same', () => {
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('system')
  })

  test('the side of a theme that stated both is that theme and that scheme', () => {
    kept.setItem('nib:theme', 'file:rose')
    kept.setItem('nib:theme-side', 'light')
    theme.init()

    expect(theme.id).toBe('file:rose')
    expect(theme.scheme).toBe('light')
  })

  test('and is written back in the new spelling, so nothing reads the old one twice', () => {
    kept.setItem('nib:theme', 'light')
    theme.init()

    expect(kept.getItem('nib:theme')).toBe('default')
    expect(kept.getItem('nib:theme-scheme')).toBe('light')
  })

  test('a scheme already written down outranks either of those', () => {
    kept.setItem('nib:theme', 'dark')
    kept.setItem('nib:theme-side', 'dark')
    kept.setItem('nib:theme-scheme', 'system')
    theme.init()

    expect(theme.scheme).toBe('system')
  })
})

/** The bug: themes installed from the store went missing from the dropdown.
 *
 *  Nothing had deleted them. One failed read of the folder emptied the list, and
 *  because the theme in force was then not in it, the choice was written away as
 *  though the file had been deleted - so it did not come back on the next launch
 *  either. A folder that will not answer says nothing about what is in it. */
describe('a folder that will not answer', () => {
  test('leaves the themes already found where they are', async () => {
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    expect(theme.files).toHaveLength(2)

    folder.listing = false
    await theme.reload()

    expect(theme.files.map((one) => one.name)).toEqual(['Rose', 'Warm Paper'])
    expect(theme.all).toHaveLength(3)
  })

  test('does not write the chosen theme away as though it had been deleted', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')

    folder.listing = false
    await theme.reload()

    expect(theme.id).toBe('file:rose')
    expect(kept.getItem('nib:theme')).toBe('file:rose')
  })

  test('and a folder that does answer still notices a theme that is gone', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')

    folder.files.delete('rose')
    await theme.reload()

    expect(theme.id).toBe('default')
    expect(theme.files).toEqual([])
  })

  test('a file that lists but will not read keeps the name and version it had', async () => {
    installed('rose', 'Rose', PAIR, '2.0.0')
    await theme.reload()

    folder.reading = false
    await theme.reload()

    expect(theme.files[0]?.name).toBe('Rose')
    expect(theme.files[0]?.variants).toEqual(['light', 'dark'])
    expect(theme.installed.get('rose')?.stamp?.version).toBe('2.0.0')
  })
})

describe('an installed theme across a restart', () => {
  test('is in the dropdown, under its own name, still chosen', async () => {
    installed('rose', 'Rose', PAIR, '2.0.0')
    kept.setItem('nib:theme', 'file:rose')
    kept.setItem('nib:theme-scheme', 'light')

    // What a launch does: read what was written down, then read the folder.
    theme.init()
    await theme.reload()

    expect(theme.all.map((one) => one.name)).toEqual(['Default', 'Rose'])
    expect(theme.id).toBe('file:rose')
    expect(theme.current).toBe('light')
    expect(theme.installed.has('rose')).toBe(true)
  })
})
