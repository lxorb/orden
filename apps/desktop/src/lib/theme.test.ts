import { glassCss } from '@orden/themes/glass'
import { wallpaperCss } from '@orden/themes/wallpaper'
import { beforeEach, describe, expect, test, vi } from 'vitest'

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

const media = {
  light: false,
  contrast: false,
  listeners: [] as ((event: { matches: boolean }) => void)[],
}

let dataset: Record<string, string> = {}
let resolves: Record<string, string> = {}
let painted: Record<string, string> = {}
let style: { id: string; textContent: string; remove: () => void } | null = null

function systemPrefers(light: boolean) {
  media.light = light
  for (const listener of media.listeners) listener({ matches: light })
}

function stubs() {
  kept = memoryStorage()
  media.light = false
  media.contrast = false
  media.listeners = []
  dataset = {}
  resolves = {}
  painted = {}
  style = null

  vi.stubGlobal('localStorage', kept)
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      get matches() {
        return query.includes('contrast') ? media.contrast : media.light
      },
      addEventListener: (_name: string, listener: (event: { matches: boolean }) => void) =>
        void media.listeners.push(listener),
    }),
  })
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => resolves[name] ?? '',
  }))
  vi.stubGlobal('document', {
    documentElement: {
      dataset,
      style: {
        setProperty: (name: string, value: string) => {
          painted[name] = value
        },
        removeProperty: (name: string) => {
          painted = Object.fromEntries(Object.entries(painted).filter(([one]) => one !== name))
        },
      },
    },
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => {
      style = { id: '', textContent: '', remove: () => undefined }
      return style
    },
    head: { append: () => undefined, insertBefore: () => undefined },
  })
}

function injected(): string {
  return style?.textContent ?? ''
}

stubs()

const folder = vi.hoisted(() => ({
  files: new Map<string, string>(),
  listing: true,
  reading: true,
}))

interface Host {
  platform: string
  material: string | null
  asked: { on: boolean; dark: boolean; said?: string | undefined; kind?: unknown }[]
  remembered: string[]
}

const host = vi.hoisted((): Host => ({
  platform: 'windows',
  material: 'mica',
  asked: [],
  remembered: [],
}))

vi.mock('./tauri', () => ({
  isDesktop: true,
  isNative: true,
  platform: () => host.platform,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    if (command === 'set_translucency') {
      host.asked.push({
        on: args.on === true,
        dark: args.dark === true,
        said: dataset.translucent,
        ...(args.kind === undefined ? {} : { kind: args.kind }),
      })
      if (args.on !== true) return Promise.resolve('')
      return host.material ? Promise.resolve(host.material) : Promise.reject(new Error('none'))
    }

    if (command === 'remember_material') {
      host.remembered.push(String(args.kind))
      return Promise.resolve()
    }

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

const { chosenFirst, theme } = await import('./theme.svelte')
const { stamped } = await import('./themes/stamp')
await Promise.all([
  import('@orden/themes/glass'),
  import('./glass/settings'),
  import('./glass/follow.svelte'),
  import('./wallpaper/sheet'),
  import('./wallpaper/settings'),
  import('./material'),
  import('./themes/declared'),
])

const PAIR = `[data-theme=light] { --bg: #fff; }\n[data-theme=dark] { --bg: #000; }`
const ONLY_LIGHT = `[data-theme=light] { color-scheme: light; --bg: #fff; }`

function installed(id: string, name: string, css: string, version = '1.0.0') {
  folder.files.set(id, stamped({ id, name, author: 'Nib', version }, css))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  stubs()
  kept.setItem('orden:theme', 'default')
  kept.setItem('orden:theme-moved', 'yes')

  folder.files.clear()
  folder.listing = true
  folder.reading = true
  host.platform = 'windows'
  host.material = 'mica'
  host.asked = []
  host.remembered = []
  theme.files = []
  theme.id = 'default'
  theme.scheme = 'system'
  theme.offerContrast = false
})

describe('what the dropdown offers', () => {
  test('is the four the app ships with, and then what is installed', async () => {
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()

    expect(theme.all.map((one) => one.id)).toEqual([
      'default',
      'contrast',
      'glass',
      'wallpaper',
      'file:rose',
      'file:warm-paper',
    ])
    expect(theme.all[0]?.name).toBe('Classic')
    expect(theme.all[1]?.name).toBe('Contrast')
    expect(theme.all[2]?.name).toBe('Glass')
  })

  test('and never a Dark or a Light, which were the scheme wearing a theme name', async () => {
    await theme.reload()

    expect(theme.all.map((one) => one.id)).not.toContain('dark')
    expect(theme.all.map((one) => one.id)).not.toContain('light')
    expect(theme.all).toHaveLength(4)
  })

  test('the built-in contrast theme brings its own palette rather than a file', () => {
    const found = theme.all.find((one) => one.id === 'contrast')

    expect(found?.path).toBeUndefined()
    expect(found?.css).toContain("[data-theme='light']")
    expect(found?.css).toContain("[data-theme='dark']")
    expect(found?.variants).toEqual(['dark', 'light'])
    expect(found?.css).toMatch(/--accent\s*:/)
  })

  test('and choosing it puts its palette on the page with nothing to fetch', () => {
    theme.select('contrast')

    expect(theme.id).toBe('contrast')
    expect(injected()).toContain('--text: #ffffff')
    expect(theme.accentIsTheme).toBe(true)
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

    expect(kept.getItem('orden:theme')).toBe('default')
    expect(kept.getItem('orden:theme-scheme')).toBe('dark')
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

describe('what an older device wrote down', () => {
  test('a theme of dark means Default, in the dark', () => {
    kept.setItem('orden:theme', 'dark')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('dark')
    expect(theme.current).toBe('dark')
  })

  test('a theme of light means Default, in the light', () => {
    kept.setItem('orden:theme', 'light')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('light')
  })

  test('a theme of system means Default, following the system', () => {
    kept.setItem('orden:theme', 'system')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('system')
  })

  test('nothing written down at all is a first launch, and not the built-in', () => {
    kept.removeItem('orden:theme')
    theme.init()

    expect(theme.id).toBe('glass')
    expect(theme.scheme).toBe('system')
  })

  test('and is written back in the new spelling, so nothing reads the old one twice', () => {
    kept.setItem('orden:theme', 'light')
    theme.init()

    expect(kept.getItem('orden:theme')).toBe('default')
    expect(kept.getItem('orden:theme-scheme')).toBe('light')
  })

  test('a scheme already written down outranks either of those', () => {
    kept.setItem('orden:theme', 'dark')
    kept.setItem('orden:theme-scheme', 'system')
    theme.init()

    expect(theme.scheme).toBe('system')
  })
})

describe('a folder that will not answer', () => {
  test('leaves the themes already found where they are', async () => {
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    expect(theme.files).toHaveLength(2)

    folder.listing = false
    await theme.reload()

    expect(theme.files.map((one) => one.name)).toEqual(['Rose', 'Warm Paper'])
    expect(theme.all).toHaveLength(6)
  })

  test('does not write the chosen theme away as though it had been deleted', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')

    folder.listing = false
    await theme.reload()

    expect(theme.id).toBe('file:rose')
    expect(kept.getItem('orden:theme')).toBe('file:rose')
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

describe('a look shown and not kept', () => {
  test('paints a file theme in the frame it is asked for, with no read in between', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()

    folder.reading = false
    theme.select('file:rose')

    expect(injected()).toContain('--bg: #000')
  })

  test('is on the page and in the store, and nowhere in the storage', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('default')
    theme.setScheme('dark')
    theme.setAccent('violet')

    theme.preview('file:rose', 'light', 'teal')

    expect(theme.id).toBe('file:rose')
    expect(dataset.theme).toBe('light')
    expect(injected()).toContain('--bg: #fff')
    expect(kept.getItem('orden:theme')).toBe('default')
    expect(kept.getItem('orden:theme-scheme')).toBe('dark')
    expect(theme.accent).toBe('teal')
    expect(kept.getItem('orden:theme-settings')).toBe(JSON.stringify({ '*': { accent: 'violet' } }))
  })

  test('and showing the kept one again is the kept one exactly', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('default')
    theme.setScheme('system')

    theme.preview('file:rose', 'dark', 'teal')
    theme.preview('default', 'system', 'violet')

    expect(theme.id).toBe('default')
    expect(theme.scheme).toBe('system')
    expect(theme.accent).toBe('violet')
    expect(dataset.theme).toBe('dark')
  })

  test('the look already on is not put on again', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()

    theme.preview('file:rose', 'dark', 'teal')
    await settled(() => injected().includes('--bg: #000'))
    style!.textContent = 'worn once'
    theme.preview('file:rose', 'dark', 'teal')
    await Promise.resolve()

    expect(injected()).toBe('worn once')
  })
})

describe('an installed theme across a restart', () => {
  test('is in the dropdown, under its own name, still chosen', async () => {
    installed('rose', 'Rose', PAIR, '2.0.0')
    kept.setItem('orden:theme', 'file:rose')
    kept.setItem('orden:theme-scheme', 'light')

    theme.init()
    await theme.reload()

    expect(theme.all.map((one) => one.name)).toEqual([
      'Classic',
      'Contrast',
      'Glass',
      'Wallpaper',
      'Rose',
    ])
    expect(theme.id).toBe('file:rose')
    expect(theme.current).toBe('light')
    expect(theme.installed.has('rose')).toBe(true)
  })
})

describe('a store copy of the contrast theme', () => {
  test('is not a second card', async () => {
    installed('contrast', 'Contrast', PAIR, '2.0.1')
    installed('rose', 'Rose', PAIR)
    await theme.reload()

    expect(theme.all.map((one) => one.name)).toEqual([
      'Classic',
      'Contrast',
      'Glass',
      'Wallpaper',
      'Rose',
    ])
    expect(theme.installed.has('contrast')).toBe(false)
  })

  test('and a reader who had it chosen is on the built-in after a restart', async () => {
    installed('contrast', 'Contrast', PAIR, '2.0.1')
    kept.setItem('orden:theme', 'file:contrast')
    kept.setItem('orden:theme-scheme', 'light')

    theme.init()
    await theme.reload()

    expect(theme.id).toBe('contrast')
    expect(kept.getItem('orden:theme')).toBe('contrast')
    expect(theme.current).toBe('light')
    expect(injected()).toContain('--text: #000000')
  })

  test('while a hand-made contrast.css is a theme of its own', async () => {
    folder.files.set('contrast', PAIR)
    kept.setItem('orden:theme', 'file:contrast')

    theme.init()
    await theme.reload()

    expect(theme.id).toBe('file:contrast')
    expect(theme.all.map((one) => one.id)).toContain('file:contrast')
  })
})

describe('answering a system that asks for more contrast', () => {
  test('is made to a fresh install whose system asks for more contrast', () => {
    media.contrast = true
    theme.init()

    expect(theme.offerContrast).toBe(true)
  })

  test('and to nobody whose system is not asking', () => {
    theme.init()

    expect(theme.offerContrast).toBe(false)
    expect(kept.getItem('orden:contrast-offered')).toBe(null)
  })

  test('once, and never again however it was answered', () => {
    media.contrast = true
    theme.init()
    expect(theme.offerContrast).toBe(true)
    expect(kept.getItem('orden:contrast-offered')).toBe('yes')

    theme.offerContrast = false
    theme.init()

    expect(theme.offerContrast).toBe(false)
  })

  test('with the theme itself, chosen and written down', () => {
    media.contrast = true
    theme.init()

    expect(theme.id).toBe('contrast')
    expect(kept.getItem('orden:theme')).toBe('contrast')
    expect(injected()).toContain('--text: #ffffff')
  })

  test('and never over a theme the reader had already chosen for themselves', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.select('file:rose')
    media.contrast = true

    theme.init()

    expect(theme.offerContrast).toBe(false)
    expect(theme.id).toBe('file:rose')
  })

  test('and nothing paints contrast onto the page, which a theme does for itself', () => {
    media.contrast = true
    theme.init()

    expect(dataset.theme).toBe('dark')
    expect('contrast' in dataset).toBe(false)
  })
})

const settled = async (done?: () => boolean) => {
  for (let turn = 0; turn < 400; turn++) {
    await new Promise((next) => setTimeout(next, 1))
    if (!done || done()) return
  }
}

describe('a first launch', () => {
  beforeEach(() => {
    kept.removeItem('orden:theme')
  })

  test('is glass, in green, following the system', async () => {
    theme.init()
    await settled(() => injected() === glassCss)

    expect(theme.id).toBe('glass')
    expect(theme.scheme).toBe('system')
    expect(theme.accent).toBe('green')
    expect(injected()).toBe(glassCss)
    expect(painted['--accent']).toBe('#3fcf8e')
    expect(host.asked.at(-1)?.on).toBe(true)
  })

  test('writes the accent down and not the theme, which nobody has chosen yet', () => {
    theme.init()

    expect(kept.getItem('orden:theme')).toBe(null)
    expect(kept.getItem('orden:theme-settings')).toBe(JSON.stringify({ '*': { accent: 'green' } }))
    expect(kept.getItem('orden:accent-given')).toBe('green')
  })

  test('and the next launch is the same look', () => {
    theme.init()
    theme.init()

    expect(theme.id).toBe('glass')
    expect(theme.accent).toBe('green')
  })

  test('keeps the green on any theme chosen after it, since the accent is the reader’s', () => {
    theme.init()
    theme.select('default')
    theme.init()

    expect(theme.id).toBe('default')
    expect(theme.accent).toBe('green')
  })

  test('and an accent chosen on it outlives the next launch', () => {
    theme.init()
    theme.setAccent('teal')
    theme.init()

    expect(theme.id).toBe('glass')
    expect(theme.accent).toBe('teal')
    expect(kept.getItem('orden:accent-given')).toBe('')
  })

  test('nor over an accent an older device kept under a key of its own', () => {
    kept.setItem('orden:accent', 'green')
    theme.init()

    expect(theme.accent).toBe('green')
  })

  test('still offers the contrast theme to a system that asks for it, then or later', () => {
    theme.init()
    expect(theme.offerContrast).toBe(false)

    media.contrast = true
    theme.init()

    expect(theme.offerContrast).toBe(true)
    expect(theme.id).toBe('contrast')
  })
})

describe('an install on the built-in', () => {
  beforeEach(() => {
    kept.removeItem('orden:theme-moved')
  })

  test('moves to glass once, in green where no accent was ever chosen', () => {
    theme.init()

    expect(theme.id).toBe('glass')
    expect(theme.accent).toBe('green')
    expect(kept.getItem('orden:theme')).toBe(null)
    expect(kept.getItem('orden:theme-moved')).toBe('yes')
  })

  test('drops a setting the app no longer has, once, and keeps the rest', () => {
    kept.setItem(
      'orden:theme-settings',
      JSON.stringify({ '*': { accent: 'teal', corners: 'square' }, glass: { warmth: 30 } }),
    )
    theme.init()

    expect(theme.accent).toBe('teal')
    expect(JSON.parse(kept.getItem('orden:theme-settings') ?? '{}')).toEqual({
      '*': { accent: 'teal' },
      glass: { warmth: 30 },
    })
  })

  test('keeps the accent and the scheme it chose', () => {
    kept.setItem('orden:theme-settings', JSON.stringify({ '*': { accent: 'teal' } }))
    kept.setItem('orden:theme-scheme', 'light')
    theme.init()

    expect(theme.id).toBe('glass')
    expect(theme.accent).toBe('teal')
    expect(theme.scheme).toBe('light')
  })

  test('the old spellings of the built-in move too', () => {
    kept.setItem('orden:theme', 'dark')
    theme.init()

    expect(theme.id).toBe('glass')
    expect(theme.scheme).toBe('dark')
  })

  test('and one who picks the built-in again afterwards keeps it', () => {
    theme.init()
    theme.select('default')
    theme.init()
    theme.init()

    expect(theme.id).toBe('default')
  })

  test('a new install that later picks the built-in keeps it too', () => {
    kept.removeItem('orden:theme')
    theme.init()
    theme.select('default')
    theme.init()

    expect(theme.id).toBe('default')
  })

  test('any other theme stays where it is', () => {
    kept.setItem('orden:theme', 'contrast')
    theme.init()

    expect(theme.id).toBe('contrast')
    expect(theme.accent).toBe('violet')
  })
})

describe('an accent the first look gave', () => {
  beforeEach(() => {
    kept.removeItem('orden:theme')
  })

  const given = (accent: string) =>
    kept.setItem('orden:theme-settings', JSON.stringify({ '*': { accent } }))

  test('the day’s yellow, on an install still on the first look, turns green once', () => {
    given('yellow')
    theme.init()

    expect(theme.id).toBe('glass')
    expect(theme.accent).toBe('green')
    expect(kept.getItem('orden:accent-given')).toBe('green')

    theme.setAccent('yellow')
    theme.init()

    expect(theme.accent).toBe('yellow')
  })

  test('but not once a theme was chosen, which is somebody in Appearance', () => {
    kept.setItem('orden:theme', 'glass')
    given('yellow')
    theme.init()

    expect(theme.accent).toBe('yellow')
    expect(kept.getItem('orden:accent-given')).toBe('')
  })

  test('nor where an older device kept its yellow under the old key', () => {
    kept.setItem('orden:accent', 'yellow')
    theme.init()

    expect(theme.accent).toBe('yellow')
  })

  test('nor any other accent an install from before the marker holds', () => {
    given('teal')
    theme.init()

    expect(theme.accent).toBe('teal')
  })

  test('follows whatever the first look gives now, on any theme, until one is picked', () => {
    kept.setItem('orden:theme', 'wallpaper')
    kept.setItem('orden:accent-given', 'teal')
    given('teal')
    theme.init()

    expect(theme.accent).toBe('green')

    theme.select('default')
    theme.setAccent('green')
    expect(kept.getItem('orden:accent-given')).toBe('')
  })
})

const DIALLED = `:root { --orden-setting-warmth: range "Warmth" 0 100 40 %; }`
const WARMTH = { '--orden-setting-warmth': 'range "Warmth" 0 100 40 %' }

describe('the settings a theme offers', () => {
  test('are the app’s own on a theme that brings no palette of its own', () => {
    theme.init()

    expect(theme.settings.map((one) => one.id)).toEqual(['accent'])
    expect(theme.accentIsTheme).toBe(false)
  })

  test('and one choice among them paints every token that depends on it', () => {
    theme.init()
    theme.setAccent('teal')

    expect(theme.accent).toBe('teal')
    expect(painted['--accent']).toBe('#33c7ba')
    expect(Object.keys(painted).sort()).toEqual([
      '--accent',
      '--accent-hover',
      '--accent-line',
      '--accent-press',
      '--accent-soft',
      '--selection',
    ])
  })

  test('are withdrawn where the theme paints their tokens itself', async () => {
    theme.init()
    theme.setAccent('teal')
    theme.select('contrast')
    await settled()

    expect(theme.settings.map((one) => one.id)).toEqual([])
    expect(theme.accentIsTheme).toBe(true)
    expect(painted).toEqual({})
  })

  test('and come back, still on the colour that was chosen, when the theme does', async () => {
    theme.init()
    theme.setAccent('teal')
    theme.select('contrast')
    await settled()
    theme.select('default')
    await settled()

    expect(theme.accent).toBe('teal')
    expect(painted['--accent']).toBe('#33c7ba')
  })

  test('follow the reader from one theme to the next, because the accent is the app’s', async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    theme.init()
    theme.setAccent('pink')

    theme.select('file:rose')
    await settled()

    expect(theme.settings.map((one) => one.id)).toEqual(['accent'])
    expect(theme.accent).toBe('pink')
  })

  test('include whatever the theme declared, after its own sheet is on the page', async () => {
    installed('warm', 'Warm', DIALLED)
    resolves = WARMTH
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)

    expect(theme.settings.map((one) => one.id)).toEqual(['accent', 'warmth'])
    expect(theme.values.warmth).toBe(40)
    expect(painted['--orden-warmth']).toBe('40%')
  })

  test('are kept when the theme is switched away from, and found again when it is back', async () => {
    installed('warm', 'Warm', DIALLED)
    resolves = WARMTH
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)
    theme.set('warmth', 75)

    theme.select('default')
    await settled()
    expect(painted['--orden-warmth']).toBeUndefined()

    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)
    expect(theme.values.warmth).toBe(75)
    expect(painted['--orden-warmth']).toBe('75%')
  })

  test('and a setting the theme has stopped offering is simply not read', async () => {
    installed('warm', 'Warm', DIALLED)
    resolves = WARMTH
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)
    theme.set('warmth', 75)

    folder.files.clear()
    installed('warm', 'Warm', ':root { --bg: #201510; }')
    resolves = {}
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length === 1)

    expect(theme.settings.map((one) => one.id)).toEqual(['accent'])
    expect(painted['--orden-warmth']).toBeUndefined()

    folder.files.clear()
    installed('warm', 'Warm', DIALLED)
    resolves = WARMTH
    await theme.reload()
    theme.select('file:warm')
    await settled(() => theme.settings.length > 1)

    expect(theme.values.warmth).toBe(75)
  })

  test('read the accent an older device wrote under a key of its own', () => {
    kept.setItem('orden:accent', 'orange')
    theme.init()

    expect(theme.accent).toBe('orange')
    expect(painted['--accent']).toBe('#f08437')
  })

  test('and what this one writes outranks it, so the key is read once and never again', () => {
    kept.setItem('orden:accent', 'orange')
    theme.init()
    theme.setAccent('green')
    theme.init()

    expect(theme.accent).toBe('green')
  })
})

describe('the glass theme', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('is fetched rather than carried, so its bytes are not in front of a launch', () => {
    const found = theme.all.find((one) => one.id === 'glass')

    expect(found?.path).toBeUndefined()
    expect(typeof found?.load).toBe('function')
  })

  test('is offered on every platform, with a material to stand on or without one', () => {
    for (const [platform, offered] of [
      ['windows', true],
      ['macos', true],
      ['linux', true],
    ] as const) {
      host.platform = platform
      theme.files = [...theme.files]
      expect(
        theme.all.some((one) => one.id === 'glass'),
        platform,
      ).toBe(offered)
    }
  })

  test('but is still worn by its id where it is not offered, which is how a drive shows it', async () => {
    host.platform = 'linux'
    theme.files = [...theme.files]
    theme.select('glass')
    await settled(() => injected().includes('--glass-chrome'))

    expect(theme.id).toBe('glass')
  })

  test('puts its sheet on the page and keeps the reader’s accent beside it', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => injected().includes('--glass-chrome'))

    expect(injected()).toBe(glassCss)
    expect(glassCss).not.toMatch(/--accent\s*:(?!\s*inherit)/)
    expect(theme.accentIsTheme).toBe(false)
  })

  test('stands the window on the material, and says so on the root once the crate has', async () => {
    theme.init()
    theme.setScheme('dark')
    theme.select('glass')
    await settled(() => dataset.translucent !== undefined)

    expect(host.asked.at(-1)).toEqual({ on: true, dark: true, said: undefined, kind: 'mica-alt' })
    expect(dataset.translucent).toBe('mica')
    expect(kept.getItem('orden:material')).toBe('mica')
  })

  test('asks for the material its row says, and keeps it for the next launch', async () => {
    theme.init()
    theme.setScheme('dark')
    theme.select('glass')
    await settled(() => theme.settings.some((one) => one.id === 'material'))
    await settled(() => dataset.translucent !== undefined)

    theme.set('material', 'clear')
    await settled(() => host.asked.at(-1)?.kind === 'clear')
    await settled(() => host.remembered.includes('clear'))
    expect(theme.keptFor('glass', 'material')).toBe('clear')
  })

  test('shows its own dials in a card of its own, the opacity with a floor', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => theme.settings.some((one) => one.id === 'opacity'))

    const own = theme.settings.filter((one) => one.own === true).map((one) => one.id)
    expect(own).toEqual(['material', 'opacity', 'follow', 'tint', 'pair', 'tab', 'content'])
    const opacity = theme.settings.find((one) => one.id === 'opacity')
    expect(opacity?.kind === 'range' && typeof opacity.least).toBe('function')
  })

  test('and asks again in the other scheme, which is what Mica is tinted by', async () => {
    theme.init()
    theme.setScheme('dark')
    theme.select('glass')
    await settled(() => dataset.translucent !== undefined)
    theme.setScheme('light')
    await settled()

    expect(host.asked.at(-1)).toMatchObject({ on: true, dark: false })
  })

  test('where there is nothing to stand on, stands on its own ground and says nothing', async () => {
    host.material = null
    theme.init()
    theme.select('glass')
    await settled(() => host.asked.length > 0)
    await settled()

    expect(dataset.translucent).toBeUndefined()
    expect(kept.getItem('orden:material')).toBeNull()
  })

  test('takes the ground back before the material when another theme is chosen', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => dataset.translucent !== undefined)
    theme.select('default')
    await settled(() => host.asked.at(-1)?.on === false)

    expect(host.asked.at(-1)).toEqual({ on: false, dark: true, said: undefined })
    expect(dataset.translucent).toBeUndefined()
    expect(kept.getItem('orden:material')).toBeNull()
  })

  test('a launch that cannot tell what it stood on asks for the material off', async () => {
    theme.init()
    await settled(() => host.asked.length > 0)

    expect(host.asked).toEqual([{ on: false, dark: true, said: undefined }])
  })

  test('and one that stood on a colour asks nothing at all', async () => {
    kept.setItem('orden:ground', 'rgb(14, 16, 19)')
    theme.init()
    await settled(() => host.asked.length > 0)

    expect(host.asked).toEqual([])
  })

  test('is shown as glass by the picker, and pointing away gives the window back', async () => {
    theme.init()
    await theme.reload()
    theme.preview('glass', 'dark', 'violet')
    await settled(() => dataset.translucent !== undefined)
    expect(dataset.translucent).toBe('mica')

    theme.preview('default', 'dark', 'violet')
    await settled(() => dataset.translucent === undefined)
    expect(dataset.translucent).toBeUndefined()
    expect(kept.getItem('orden:material')).toBeNull()
  })

  test('opens a launch in the sheet it wore last time, before its own chunk is in', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => injected() === glassCss)

    const storage = kept
    stubs()
    kept = storage
    vi.stubGlobal('localStorage', kept)
    theme.id = 'default'
    theme.init()

    expect(injected()).toBe(glassCss)
  })

  test('hands its sheet to the picker, which draws its card from it', async () => {
    theme.warm()
    await settled(() => theme.all.find((one) => one.id === 'glass')?.css !== undefined)

    expect(theme.all.find((one) => one.id === 'glass')?.css).toBe(glassCss)
  })
})

describe('a dial being dragged', () => {
  test('is shown and kept nowhere, and letting go keeps it', async () => {
    theme.init()
    theme.select('wallpaper')
    await settled(() => theme.settings.some((one) => one.id === 'dim'))
    const before = kept.getItem('orden:theme-settings')

    theme.try('dim', 55)
    expect(painted['--orden-dim']).toBe('55%')
    expect(theme.values.dim).toBe(55)
    expect(theme.previewing).toBe(true)
    expect(kept.getItem('orden:theme-settings')).toBe(before)

    theme.set('dim', 55)
    expect(theme.previewing).toBe(false)
    expect(theme.keptFor('wallpaper', 'dim')).toBe(55)
  })
})

describe('the wallpaper theme', () => {
  const DIALS = [
    'blur',
    'dim',
    'saturation',
    'tint',
    'tint-colour',
    'grain',
    'fit',
    'empty',
    'content',
  ]
  const HELD = {
    picture: 'data:image/png;base64,iVBORw0KGgo=',
    blur: 28,
    dark: { floor: 0.52, ground: '#202630' },
    light: { floor: 0.61, ground: '#e9ecf2' },
  }

  beforeEach(() => theme.rewear('wallpaper'))

  test('is offered everywhere, since the page draws it rather than the platform', () => {
    for (const platform of ['windows', 'macos', 'linux', 'android', 'ios']) {
      host.platform = platform
      theme.files = [...theme.files]
      expect(
        theme.all.some((one) => one.id === 'wallpaper'),
        platform,
      ).toBe(true)
    }
  })

  test('is fetched rather than carried, and with nothing chosen is its sheet and dials', async () => {
    const found = theme.all.find((one) => one.id === 'wallpaper')
    expect(found?.path).toBeUndefined()
    expect(typeof found?.load).toBe('function')

    theme.init()
    theme.select('wallpaper')
    await settled(() => injected().startsWith(wallpaperCss))

    expect(injected()).not.toContain('--wallpaper-picture:')
    expect(injected()).toContain('--orden-dim: 10%;')
    expect(wallpaperCss).not.toMatch(/--accent\s*:/)
    expect(theme.accentIsTheme).toBe(false)
  })

  test('says the picture written down after its own sheet, with both floors', async () => {
    kept.setItem('orden:wallpaper', JSON.stringify(HELD))
    theme.init()
    theme.select('wallpaper')
    await settled(() => injected().includes('--wallpaper-picture:'))

    expect(injected().startsWith(wallpaperCss)).toBe(true)
    expect(injected()).toContain(`--wallpaper-picture: url("${HELD.picture}");`)
    expect(injected()).toContain('--wallpaper-floor-dark: 52%;')
    expect(injected()).toContain('--wallpaper-floor-light: 61%;')
  })

  test('opens a launch on its picture, before any chunk is in', async () => {
    kept.setItem('orden:wallpaper', JSON.stringify(HELD))
    theme.init()
    theme.select('wallpaper')
    await settled(() => injected().includes('--wallpaper-picture:'))

    const storage = kept
    stubs()
    kept = storage
    vi.stubGlobal('localStorage', kept)
    theme.id = 'default'
    theme.init()

    expect(injected()).toContain(`url("${HELD.picture}")`)
  })

  test('wears a new picture when it is read again, and keeps its dials meanwhile', async () => {
    theme.init()
    theme.select('wallpaper')
    await settled(() => theme.settings.some((one) => one.id === 'dim'))

    kept.setItem('orden:wallpaper', JSON.stringify(HELD))
    theme.rewear('wallpaper')
    expect(theme.settings.some((one) => one.id === 'blur')).toBe(true)
    await settled(() => injected().includes('--wallpaper-picture:'))
    expect(theme.settings.map((one) => one.id)).toEqual(['accent', ...DIALS])
  })

  test('is shown by the picker as it would be, and pointing away keeps nothing', async () => {
    kept.setItem('orden:wallpaper', JSON.stringify(HELD))
    theme.init()
    theme.preview('wallpaper', 'dark', 'violet')
    await settled(() => injected().includes('--wallpaper-picture:'))

    theme.preview('default', 'dark', 'violet')
    await settled(() => injected() === '')
    expect(kept.getItem('orden:theme')).not.toBe('wallpaper')
  })

  test('says its dials in code, which Appearance draws in a card of its own', async () => {
    theme.init()
    theme.select('wallpaper')
    await settled(() => theme.settings.some((one) => one.id === 'dim'))

    expect(theme.settings.map((one) => one.id)).toEqual(['accent', ...DIALS])
    expect(theme.settings.filter((one) => one.own === true).map((one) => one.id)).toEqual(DIALS)
    theme.set('dim', 35)
    expect(painted['--orden-dim']).toBe('35%')
    expect(theme.keptFor('wallpaper', 'dim')).toBe(35)
  })
})

describe('translucency, which was a switch before it was glass', () => {
  test('under the built-in theme is glass', () => {
    theme.init()
    theme.adoptTranslucency()

    expect(theme.id).toBe('glass')
    expect(kept.getItem('orden:theme')).toBe('glass')
  })

  test('under a theme somebody chose is that theme still', () => {
    theme.init()
    theme.select('contrast')
    theme.adoptTranslucency()

    expect(theme.id).toBe('contrast')
  })

  test('and where there is no material at all is nothing', () => {
    host.platform = 'linux'
    theme.init()
    theme.adoptTranslucency()

    expect(theme.id).toBe('default')
  })
})

describe('a theme’s own faces', () => {
  test('keep the reader’s in front of a stack the theme states', () => {
    expect(chosenFirst(':root {\n  --font-content: Georgia, serif;\n}')).toBe(
      ':root {\n  --font-content: var(--font-content-chosen,) Georgia, serif;\n}',
    )
    expect(chosenFirst(':root { --font-ui: Inter; --font-mono: Iosevka; }')).toBe(
      ':root { --font-ui: var(--font-ui-chosen,) Inter; --font-mono: var(--font-mono-chosen,) Iosevka; }',
    )
  })

  test('and of a face the theme gives the prose, the code’s for code', () => {
    const css =
      '#write p {\n  font-family: Palatino;\n}\n#write pre code {\n  font-family: Menlo;\n}'
    expect(chosenFirst(css)).toBe(
      '#write p {\n  font-family: var(--font-content-chosen,) Palatino;\n}\n' +
        '#write pre code {\n  font-family: var(--font-mono-chosen,) Menlo;\n}',
    )
  })

  test('leave a stack that already starts with a token alone, so twice is once', () => {
    const once = chosenFirst(':root { --font-content: Georgia; }')
    expect(chosenFirst(once)).toBe(once)
    expect(chosenFirst(':root { --font-content: var(--font-ui); }')).toBe(
      ':root { --font-content: var(--font-ui); }',
    )
  })

  test('and touch nothing else a theme says', () => {
    const css = ':root { --bg: #fff; --text: #111; }\n#write h1 { color: red; }'
    expect(chosenFirst(css)).toBe(css)
  })
})
