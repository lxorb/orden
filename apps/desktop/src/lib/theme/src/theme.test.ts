import { glassCss } from '@orden/themes/glass'
import { wallpaperCss } from '@orden/themes/wallpaper'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'
import '../../theme-ports'

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
let hearing: ((event: { key: string | null }) => void)[] = []

function writtenElsewhere(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) kept.setItem(key, value)
  for (const key of Object.keys(values)) for (const heard of hearing) heard({ key })
}

function systemPrefers(light: boolean) {
  media.light = light
  for (const listener of media.listeners) listener({ matches: light })
}

function stubs(storage = memoryStorage()) {
  kept = storage
  media.light = false
  media.contrast = false
  media.listeners = []
  dataset = {}
  resolves = {}
  painted = {}
  style = null
  hearing = []
  vi.stubGlobal('localStorage', kept)
  vi.stubGlobal('window', {
    addEventListener: (name: string, listener: (event: { key: string | null }) => void) => {
      if (name === 'storage') hearing.push(listener)
    },
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
    addEventListener: () => undefined,
    querySelector: () => null,
    getElementById: () => null,
    createElement: () => {
      style = { id: '', textContent: '', remove: () => undefined }
      return style
    },
    head: { append: () => undefined, insertBefore: () => undefined },
  })
}

const injected = () => style?.textContent ?? ''

stubs()

const folder = vi.hoisted(() => ({
  files: new Map<string, string>(),
  listing: true,
  reading: true,
}))
const host = vi.hoisted(() => ({ platform: 'windows', called: [] as string[] }))

vi.mock('../../platform/src/tauri', () => ({
  isDesktop: true,
  isNative: true,
  platform: () => host.platform,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    host.called.push(command)
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
    if (command === 'write_theme') {
      folder.files.set(String(args.id), String(args.css))
      return Promise.resolve(`/themes/${String(args.id)}.css`)
    }
    if (command === 'read_theme') {
      if (!folder.reading) return Promise.reject(new Error('cannot read'))
      const id = /\/themes\/(.*)\.css$/.exec(String(args.path))?.[1] ?? ''
      return Promise.resolve(folder.files.get(id) ?? '')
    }
    return Promise.resolve('')
  },
}))

vi.mock('../../ui-kit/src/insets', () => ({ tintSystemBars: () => undefined }))

const { chosenFirst, theme } = await import('./theme.svelte')
const { stamped, stampOf } = await import('./stamp')
await Promise.all([
  import('@orden/themes/glass'),
  import('../../theme-looks/src/api'),
  import('../../theme-looks/src/glass/settings'),
  import('../../theme-looks/src/glass/follow.svelte'),
  import('../../theme-looks/src/wallpaper/sheet'),
  import('../../theme-looks/src/wallpaper/settings'),
  import('./declared'),
])

const PAIR = `[data-theme=light] { --bg: #fff; }\n[data-theme=dark] { --bg: #000; }`
const ONLY_LIGHT = `[data-theme=light] { color-scheme: light; --bg: #fff; }`
const BUILT_IN = ['Classic', 'Contrast', 'Glass', 'Wallpaper']

function installed(id: string, name: string, css: string, version = '1.0.0') {
  folder.files.set(id, stamped({ id, name, author: 'Orden', version }, css))
}

async function chosen(id: string, name: string, css: string) {
  installed(id, name, css)
  await theme.reload()
  theme.select(`file:${id}`)
}

const ids = () => theme.all.map((one) => one.id)
const settingIds = () => theme.settings.map((one) => one.id)
const ownIds = () => theme.settings.filter((one) => one.own === true).map((one) => one.id)
const offeredOn = (id: string) => theme.all.some((one) => one.id === id)

function relaunch() {
  stubs(kept)
  theme.id = 'default'
  theme.init()
}

const settled = async (done?: () => boolean) => {
  for (let turn = 0; turn < 400; turn++) {
    await new Promise((next) => setTimeout(next, 1))
    if (!done || done()) return
  }
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
  host.called = []
  theme.files = []
  theme.id = 'default'
  theme.scheme = 'system'
  theme.offerContrast = false
})

describe('what the dropdown offers', () => {
  test('is the four the app ships with, never a Dark or a Light, and then what is installed', async () => {
    await theme.reload()
    expect(ids()).not.toContain('dark')
    expect(ids()).not.toContain('light')
    expect(theme.all).toHaveLength(4)
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    expect(ids()).toEqual([
      'default',
      'contrast',
      'glass',
      'wallpaper',
      'file:rose',
      'file:warm-paper',
    ])
    expect(theme.all.slice(0, 3).map((one) => one.name)).toEqual(BUILT_IN.slice(0, 3))
  })

  test('the built-in contrast theme brings its own palette, and the built-in carries both schemes', () => {
    const found = theme.all.find((one) => one.id === 'contrast')
    expect(found?.path).toBeUndefined()
    expect(found?.css).toContain("[data-theme='light']")
    expect(found?.css).toContain("[data-theme='dark']")
    expect(found?.variants).toEqual(['dark', 'light'])
    expect(found?.css).toMatch(/--accent\s*:/)
    expect(theme.active.variants).toEqual(['dark', 'light'])
    expect(theme.switchable).toBe(true)
  })

  test('and choosing contrast puts its palette on the page with nothing to fetch', () => {
    theme.select('contrast')
    expect(theme.id).toBe('contrast')
    expect(injected()).toContain('--text: #ffffff')
    expect(theme.accentIsTheme).toBe(true)
  })
})

describe('a second window', () => {
  test('is heard over a preview that has ended', () => {
    theme.init()
    const [first, second] = theme.accents.slice(-2).map((one) => one.id)
    writtenElsewhere({ 'orden:theme-settings': JSON.stringify({ '*': { accent: first } }) })
    theme.preview('contrast', theme.kept.scheme, second ?? '')
    theme.preview(theme.kept.id, theme.kept.scheme, theme.kept.accent)
    writtenElsewhere({ 'orden:theme-settings': JSON.stringify({ '*': { accent: second } }) })
    expect(theme.accent).toBe(second)
  })

  test('reads the folder again for a theme it has not listed', async () => {
    theme.init()
    await settled()
    installed('rose', 'Rose', '[data-theme="dark"] { --bg: #200; }')
    writtenElsewhere({ 'orden:theme': 'file:rose' })
    await settled(() => theme.active.id === 'file:rose')
    expect(theme.active.id).toBe('file:rose')
  })

  test('is heard when it changes the theme or the scheme', () => {
    theme.init()
    writtenElsewhere({ 'orden:theme': 'contrast' })
    expect(theme.id).toBe('contrast')
    expect(theme.kept.id).toBe('contrast')
    writtenElsewhere({ 'orden:theme-scheme': 'light' })
    expect(theme.scheme).toBe('light')
  })

  test('keeps a theme setting it chose when this one changes another', () => {
    theme.init()
    const accent = theme.accents.at(-1)?.id ?? ''
    writtenElsewhere({ 'orden:theme-settings': JSON.stringify({ '*': { accent } }) })
    expect(theme.kept.accent).toBe(accent)
    theme.setFor('somewhere', 'dial', 3)
    const written = JSON.parse(kept.getItem('orden:theme-settings') ?? '{}') as Record<
      string,
      { accent?: string }
    >
    expect(written['*']?.accent).toBe(accent)
  })
})

describe('the scheme, which is not a theme', () => {
  test('follows the system until one of the two is asked for, then stops', () => {
    theme.init()
    expect(theme.scheme).toBe('system')
    expect(theme.current).toBe('dark')
    systemPrefers(true)
    expect(theme.current).toBe('light')
    theme.setScheme('dark')
    systemPrefers(true)
    expect(theme.current).toBe('dark')
    expect(kept.getItem('orden:theme')).toBe('default')
    expect(kept.getItem('orden:theme-scheme')).toBe('dark')
  })

  test('is not touched by choosing a theme', async () => {
    theme.init()
    theme.setScheme('light')
    await chosen('rose', 'Rose', PAIR)
    expect(theme.id).toBe('file:rose')
    expect(theme.scheme).toBe('light')
    expect(theme.current).toBe('light')
  })
})

describe('a theme with one scheme', () => {
  test('shows the scheme it has, whatever was asked for, and the control points at it', async () => {
    theme.init()
    theme.setScheme('dark')
    await chosen('warm-paper', 'Warm Paper', ONLY_LIGHT)
    expect(theme.current).toBe('light')
    expect(theme.scheme).toBe('dark')
    expect(theme.shown).toBe('light')
    theme.select('default')
    expect(theme.shown).toBe('dark')
  })

  test('offers neither the other scheme nor the system, refuses it, and the panel foot cannot switch it', async () => {
    await chosen('warm-paper', 'Warm Paper', ONLY_LIGHT)
    expect(theme.offers('light')).toBe(true)
    expect(theme.offers('dark')).toBe(false)
    expect(theme.offers('system')).toBe(false)
    expect(theme.switchable).toBe(false)
    theme.setScheme('dark')
    theme.toggle()
    expect(theme.current).toBe('light')
    expect(theme.id).toBe('file:warm-paper')
  })
})

describe('the switch in the panel foot', () => {
  test('flips the scheme and leaves the theme where it is', async () => {
    theme.init()
    await chosen('rose', 'Rose', PAIR)
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
  test.each(['dark', 'light', 'system'] as const)(
    'a theme of %s means Default in that scheme, written back in the new spelling',
    (scheme) => {
      kept.setItem('orden:theme', scheme)
      theme.init()
      expect(theme.id).toBe('default')
      expect(theme.scheme).toBe(scheme)
      if (scheme !== 'system') expect(theme.current).toBe(scheme)
      expect(kept.getItem('orden:theme')).toBe('default')
      expect(kept.getItem('orden:theme-scheme')).toBe(scheme)
    },
  )

  test('nothing written down at all is a first launch, and not the built-in', () => {
    kept.removeItem('orden:theme')
    theme.init()
    expect(theme.id).toBe('glass')
    expect(theme.scheme).toBe('system')
  })

  test('a scheme already written down outranks either of those', () => {
    kept.setItem('orden:theme', 'dark')
    kept.setItem('orden:theme-scheme', 'system')
    theme.init()
    expect(theme.scheme).toBe('system')
  })
})

describe('a folder that will not answer', () => {
  test('leaves the themes already found and the chosen one where they are', async () => {
    installed('rose', 'Rose', PAIR)
    installed('warm-paper', 'Warm Paper', ONLY_LIGHT)
    await theme.reload()
    theme.select('file:rose')
    expect(theme.files).toHaveLength(2)
    folder.listing = false
    await theme.reload()
    expect(theme.files.map((one) => one.name)).toEqual(['Rose', 'Warm Paper'])
    expect(theme.all).toHaveLength(6)
    expect(theme.id).toBe('file:rose')
    expect(kept.getItem('orden:theme')).toBe('file:rose')
  })

  test('and a folder that does answer still notices a theme that is gone', async () => {
    await chosen('rose', 'Rose', PAIR)
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
  beforeEach(async () => {
    installed('rose', 'Rose', PAIR)
    await theme.reload()
  })

  test('paints a file theme in the frame it is asked for, with no read in between', () => {
    folder.reading = false
    theme.select('file:rose')
    expect(injected()).toContain('--bg: #000')
  })

  test('is on the page and in the store, and nowhere in the storage', () => {
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

  test('and showing the kept one again is the kept one exactly', () => {
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
    theme.preview('file:rose', 'dark', 'teal')
    await settled(() => injected().includes('--bg: #000'))
    style!.textContent = 'worn once'
    theme.preview('file:rose', 'dark', 'teal')
    await Promise.resolve()
    expect(injected()).toBe('worn once')
  })
})

describe('a look kept with the account', () => {
  test('tells of a pick, and not of a look shown, a dial tried or a fall back', async () => {
    theme.init()
    let told = 0
    const stop = theme.picked(() => told++)
    theme.select('default')
    theme.setScheme('dark')
    theme.setAccent('violet')
    expect(told).toBe(3)
    theme.preview('contrast', 'light', 'teal')
    theme.try('accent', 'teal')
    theme.preview('default', 'dark', 'violet')
    expect(told).toBe(3)
    theme.select('file:gone')
    await theme.reload()
    expect(theme.id).toBe('default')
    expect(told).toBe(4)
    stop()
  })

  test('is the kept look, not one being shown, and carries the sheet of a theme from the folder', async () => {
    theme.init()
    await chosen('rose', 'Rose', PAIR)
    const css = theme.look().css ?? ''
    expect(css).toContain('--bg: #fff')
    expect(stampOf(css)?.name).toBe('Rose')
    theme.select('default')
    theme.setScheme('dark')
    theme.setAccent('violet')
    theme.preview('file:rose', 'light', 'teal')
    const look = theme.look()
    expect(look.theme).toBe('default')
    expect(look.scheme).toBe('dark')
    expect(look.values['*']?.accent).toBe('violet')
    expect(look.css).toBe('')
  })

  test('from another device is worn, the theme it names written where it was missing', async () => {
    theme.init()
    let told = 0
    const stop = theme.picked(() => told++)
    await theme.wearLook({
      theme: 'file:rose',
      scheme: 'light',
      values: { '*': { accent: 'teal' } },
      css: stamped({ id: 'rose', name: 'Rose', author: 'Orden', version: '1' }, PAIR),
    })
    expect(folder.files.has('rose')).toBe(true)
    expect(theme.id).toBe('file:rose')
    expect(dataset.theme).toBe('light')
    expect(theme.accent).toBe('teal')
    expect(kept.getItem('orden:theme')).toBe('file:rose')
    expect(kept.getItem('orden:theme-scheme')).toBe('light')
    await settled(() => injected().includes('--bg: #fff'))
    expect(injected()).toContain('--bg: #fff')
    expect(told).toBe(0)
    stop()
  })

  test('waits for the folder to be read before calling a theme missing', async () => {
    installed('rose', 'Rose', PAIR)
    theme.init()
    await theme.wearLook({ theme: 'file:rose', scheme: 'dark', values: {} })
    expect(theme.id).toBe('file:rose')
    expect(theme.kept.id).toBe('file:rose')
  })

  test('keeps the theme on this device when the one named is nowhere to be had', async () => {
    theme.init()
    theme.select('contrast')
    await theme.wearLook({ theme: 'file:gone', scheme: 'dark', values: {} })
    expect(theme.id).toBe('contrast')
    expect(theme.kept.scheme).toBe('dark')
    expect(folder.files.has('gone')).toBe(false)
  })

  test('moves a look being shown onto the new kept one', async () => {
    theme.init()
    theme.select('contrast')
    theme.setAccent('violet')
    theme.preview('default', 'light', 'teal')
    let told = 0
    const stop = theme.rewore(() => told++)
    await theme.wearLook({ theme: 'default', scheme: 'dark', values: { '*': { accent: 'blue' } } })
    expect(theme.kept).toEqual({ id: 'default', scheme: 'dark', accent: 'blue' })
    expect(theme.id).toBe('default')
    expect(theme.accent).toBe('blue')
    expect(theme.previewing).toBe(false)
    expect(told).toBe(1)
    stop()
  })
})

describe('an installed theme across a restart', () => {
  test('is in the dropdown, under its own name, still chosen', async () => {
    installed('rose', 'Rose', PAIR, '2.0.0')
    kept.setItem('orden:theme', 'file:rose')
    kept.setItem('orden:theme-scheme', 'light')
    theme.init()
    await theme.reload()
    expect(theme.all.map((one) => one.name)).toEqual([...BUILT_IN, 'Rose'])
    expect(theme.id).toBe('file:rose')
    expect(theme.current).toBe('light')
    expect(theme.installed.has('rose')).toBe(true)
  })

  test('one saved from a browser before is still the Orden theme it was saved as', async () => {
    const css = `[data-theme=dark] { color-scheme: dark; --bg: #1c1b22; --text: #fbfbfe; }`
    folder.files.set(
      'balanced',
      stamped({ id: 'balanced', name: 'Balanced', author: 'Firefox', version: '1' }, css),
    )
    kept.setItem('orden:theme', 'file:balanced')
    theme.init()
    await theme.reload()
    expect(theme.id).toBe('file:balanced')
    expect(theme.all.find((one) => one.id === 'file:balanced')?.name).toBe('Balanced')
    expect(theme.current).toBe('dark')
    expect(folder.files.get('balanced')).toContain(css)
  })
})

describe('a store copy of the contrast theme', () => {
  test('is not a second card', async () => {
    installed('contrast', 'Contrast', PAIR, '2.0.1')
    installed('rose', 'Rose', PAIR)
    await theme.reload()
    expect(theme.all.map((one) => one.name)).toEqual([...BUILT_IN, 'Rose'])
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
    expect(ids()).toContain('file:contrast')
  })
})

describe('answering a system that asks for more contrast', () => {
  test('is made once to a fresh install whose system asks, with the theme chosen, written down and not painted as contrast', () => {
    media.contrast = true
    theme.init()
    expect(theme.offerContrast).toBe(true)
    expect(kept.getItem('orden:contrast-offered')).toBe('yes')
    expect(theme.id).toBe('contrast')
    expect(kept.getItem('orden:theme')).toBe('contrast')
    expect(injected()).toContain('--text: #ffffff')
    expect(dataset.theme).toBe('dark')
    expect('contrast' in dataset).toBe(false)
    theme.offerContrast = false
    theme.init()
    expect(theme.offerContrast).toBe(false)
  })

  test('and to nobody whose system is not asking', () => {
    theme.init()
    expect(theme.offerContrast).toBe(false)
    expect(kept.getItem('orden:contrast-offered')).toBe(null)
  })

  test('and never over a theme the reader had already chosen for themselves', async () => {
    await chosen('rose', 'Rose', PAIR)
    media.contrast = true
    theme.init()
    expect(theme.offerContrast).toBe(false)
    expect(theme.id).toBe('file:rose')
  })
})

describe('a first launch', () => {
  beforeEach(() => kept.removeItem('orden:theme'))

  test('is glass, in green, following the system, writing the accent down and not the theme', async () => {
    theme.init()
    expect(kept.getItem('orden:theme')).toBe(null)
    expect(kept.getItem('orden:theme-settings')).toBe(JSON.stringify({ '*': { accent: 'green' } }))
    expect(kept.getItem('orden:accent-given')).toBe('green')
    await settled(() => injected() === glassCss)
    expect(theme.id).toBe('glass')
    expect(theme.scheme).toBe('system')
    expect(theme.accent).toBe('green')
    expect(injected()).toBe(glassCss)
    expect(painted['--accent']).toBe('#3fcf8e')
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
  beforeEach(() => kept.removeItem('orden:theme-moved'))

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

  test.each([true, false])(
    'and one who picks the built-in again afterwards keeps it (new install: %s)',
    (fresh) => {
      if (fresh) kept.removeItem('orden:theme')
      theme.init()
      theme.select('default')
      theme.init()
      theme.init()
      expect(theme.id).toBe('default')
    },
  )

  test('any other theme stays where it is', () => {
    kept.setItem('orden:theme', 'contrast')
    theme.init()
    expect(theme.id).toBe('contrast')
    expect(theme.accent).toBe('violet')
  })
})

describe('an accent the first look gave', () => {
  beforeEach(() => kept.removeItem('orden:theme'))

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

  test.each([
    ['an older device kept its yellow under the old key', 'orden:accent', 'yellow'],
    ['an install from before the marker holds another accent', 'orden:theme-settings', 'teal'],
  ])('nor where %s', (_, key, accent) => {
    if (key === 'orden:accent') kept.setItem(key, accent)
    else given(accent)
    theme.init()
    expect(theme.accent).toBe(accent)
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

async function warmChosen(css = DIALLED, dials: Record<string, string> = WARMTH) {
  folder.files.clear()
  installed('warm', 'Warm', css)
  resolves = dials
  await theme.reload()
  theme.select('file:warm')
  await settled(() => (css === DIALLED ? theme.settings.length > 1 : theme.settings.length === 1))
}

describe('the settings a theme offers', () => {
  test('are the app’s own on a theme that brings no palette, one choice painting every token on it', () => {
    theme.init()
    expect(settingIds()).toEqual(['accent'])
    expect(theme.accentIsTheme).toBe(false)
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

  test('are withdrawn where the theme paints their tokens itself, and come back on the colour chosen', async () => {
    theme.init()
    theme.setAccent('teal')
    theme.select('contrast')
    await settled()
    expect(settingIds()).toEqual([])
    expect(theme.accentIsTheme).toBe(true)
    expect(painted).toEqual({})
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
    expect(settingIds()).toEqual(['accent'])
    expect(theme.accent).toBe('pink')
  })

  test('include whatever the theme declared, kept when it is switched away from and found again', async () => {
    await warmChosen()
    expect(settingIds()).toEqual(['accent', 'warmth'])
    expect(theme.values.warmth).toBe(40)
    expect(painted['--orden-warmth']).toBe('40%')
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
    await warmChosen()
    theme.set('warmth', 75)
    await warmChosen(':root { --bg: #201510; }', {})
    expect(settingIds()).toEqual(['accent'])
    expect(painted['--orden-warmth']).toBeUndefined()
    await warmChosen()
    expect(theme.values.warmth).toBe(75)
  })

  test('read the accent an older device wrote under a key of its own, until this one writes', () => {
    kept.setItem('orden:accent', 'orange')
    theme.init()
    expect(theme.accent).toBe('orange')
    expect(painted['--accent']).toBe('#f08437')
    theme.setAccent('green')
    theme.init()
    expect(theme.accent).toBe('green')
  })
})

describe('the glass theme', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  test('is fetched rather than carried, offered on every platform, and still worn by its id', async () => {
    const found = theme.all.find((one) => one.id === 'glass')
    expect(found?.path).toBeUndefined()
    expect(typeof found?.load).toBe('function')
    for (const platform of ['windows', 'macos', 'linux']) {
      host.platform = platform
      theme.files = [...theme.files]
      expect(offeredOn('glass'), platform).toBe(true)
    }
    theme.select('glass')
    await settled(() => injected().includes('--glass-chrome'))
    expect(theme.id).toBe('glass')
  })

  test('puts its sheet on the page and keeps the reader’s accent beside it, its own dials in a card', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => injected().includes('--glass-chrome'))
    expect(injected()).toBe(glassCss)
    expect(glassCss).not.toMatch(/--accent\s*:(?!\s*inherit)/)
    expect(theme.accentIsTheme).toBe(false)
    await settled(() => settingIds().includes('follow'))
    expect(ownIds()).toEqual(['follow', 'tint', 'pair', 'tab'])
  })

  test('passes over the material, opacity and content an older build kept for it (#2162)', async () => {
    kept.setItem(
      'orden:theme-settings',
      JSON.stringify({ glass: { material: 'acrylic', opacity: 20, content: 'clear', tint: 40 } }),
    )
    kept.setItem('orden:material', 'acrylic')
    kept.setItem('orden:ground', 'rgba(0, 0, 0, 0)')
    theme.init()
    theme.select('glass')
    await settled(() => settingIds().includes('follow'))
    expect(ownIds()).toEqual(['follow', 'tint', 'pair', 'tab'])
    expect(theme.keptFor('glass', 'tint')).toBe(40)
    expect(dataset.translucent).toBeUndefined()
    expect(host.called).not.toContain('set_translucency')
  })

  test('is shown as glass by the picker, and pointing away gives the window back', async () => {
    theme.init()
    await theme.reload()
    theme.preview('glass', 'dark', 'violet')
    await settled(() => injected() === glassCss)
    theme.preview('default', 'dark', 'violet')
    await settled(() => injected() === '')
    expect(kept.getItem('orden:theme')).not.toBe('glass')
  })

  test('opens a launch in the sheet it wore last time, before its own chunk is in', async () => {
    theme.init()
    theme.select('glass')
    await settled(() => injected() === glassCss)
    relaunch()
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
    await settled(() => settingIds().includes('dim'))
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
  const pictured = () => injected().includes('--wallpaper-picture:')

  async function worn(held: boolean) {
    if (held) kept.setItem('orden:wallpaper', JSON.stringify(HELD))
    theme.init()
    theme.select('wallpaper')
    await settled(held ? pictured : () => settingIds().includes('dim'))
  }

  beforeEach(() => theme.rewear('wallpaper'))

  test('is offered everywhere, since the page draws it rather than the platform', () => {
    for (const platform of ['windows', 'macos', 'linux', 'android', 'ios']) {
      host.platform = platform
      theme.files = [...theme.files]
      expect(offeredOn('wallpaper'), platform).toBe(true)
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

  test('says the picture written down after its own sheet, with both floors, and opens a launch on it', async () => {
    await worn(true)
    expect(injected().startsWith(wallpaperCss)).toBe(true)
    expect(injected()).toContain(`--wallpaper-picture: url("${HELD.picture}");`)
    expect(injected()).toContain('--wallpaper-floor-dark: 52%;')
    expect(injected()).toContain('--wallpaper-floor-light: 61%;')
    relaunch()
    expect(injected()).toContain(`url("${HELD.picture}")`)
  })

  test('wears a new picture when it is read again, and keeps its dials meanwhile', async () => {
    await worn(false)
    kept.setItem('orden:wallpaper', JSON.stringify(HELD))
    theme.rewear('wallpaper')
    expect(settingIds()).toContain('blur')
    await settled(pictured)
    expect(settingIds()).toEqual(['accent', ...DIALS])
  })

  test('is shown by the picker as it would be, and pointing away keeps nothing', async () => {
    kept.setItem('orden:wallpaper', JSON.stringify(HELD))
    theme.init()
    theme.preview('wallpaper', 'dark', 'violet')
    await settled(pictured)
    theme.preview('default', 'dark', 'violet')
    await settled(() => injected() === '')
    expect(kept.getItem('orden:theme')).not.toBe('wallpaper')
  })

  test('says its dials in code, which Appearance draws in a card of its own', async () => {
    await worn(false)
    expect(settingIds()).toEqual(['accent', ...DIALS])
    expect(ownIds()).toEqual(DIALS)
    theme.set('dim', 35)
    expect(painted['--orden-dim']).toBe('35%')
    expect(theme.keptFor('wallpaper', 'dim')).toBe(35)
  })
})

describe('a theme’s own faces', () => {
  test.each([
    [
      ':root {\n  --font-content: Georgia, serif;\n}',
      ':root {\n  --font-content: var(--font-content-chosen,) Georgia, serif;\n}',
    ],
    [
      ':root { --font-ui: Inter; --font-mono: Iosevka; }',
      ':root { --font-ui: var(--font-ui-chosen,) Inter; --font-mono: var(--font-mono-chosen,) Iosevka; }',
    ],
    [
      '#write p {\n  font-family: Palatino;\n}\n#write pre code {\n  font-family: Menlo;\n}',
      '#write p {\n  font-family: var(--font-content-chosen,) Palatino;\n}\n' +
        '#write pre code {\n  font-family: var(--font-mono-chosen,) Menlo;\n}',
    ],
    [':root { --font-content: var(--font-ui); }', ':root { --font-content: var(--font-ui); }'],
    [
      ':root { --bg: #fff; --text: #111; }\n#write h1 { color: red; }',
      ':root { --bg: #fff; --text: #111; }\n#write h1 { color: red; }',
    ],
  ])(
    'keep the reader’s in front of a stack the theme states, and touch nothing else: %s',
    (css, out) => {
      expect(chosenFirst(css)).toBe(out)
      expect(chosenFirst(out)).toBe(out)
    },
  )
})

describe('another window of the app', () => {
  const accented = (accent: string) => JSON.stringify({ '*': { accent } })

  test('quick add wears the look the app chose and follows each change, keeping nothing', async () => {
    writtenElsewhere({
      'orden:theme': 'contrast',
      'orden:theme-scheme': 'light',
      'orden:theme-settings': accented('red'),
    })
    theme.init(false)
    await vi.waitFor(() => expect(injected()).toContain('--text: #'))
    expect(theme.id).toBe('contrast')
    expect(dataset.theme).toBe('light')
    writtenElsewhere({
      'orden:theme': 'default',
      'orden:theme-scheme': 'dark',
      'orden:theme-settings': accented('teal'),
    })
    await vi.waitFor(() => expect(dataset.theme).toBe('dark'))
    expect(theme.id).toBe('default')
    expect(theme.accent).toBe('teal')
    expect(painted['--accent']).toBe('#33c7ba')
    expect(kept.getItem('orden:theme')).toBe('default')
    expect(kept.getItem('orden:theme-settings')).toBe(accented('teal'))
    expect(kept.getItem('orden:theme-sheet')).toBeNull()
  })

  test('a second window of notes follows a scheme and accent chosen in the first', async () => {
    theme.init()
    writtenElsewhere({ 'orden:theme-scheme': 'light', 'orden:theme-settings': accented('orange') })
    await vi.waitFor(() => expect(painted['--accent']).toBe('#c44500'))
    expect(theme.scheme).toBe('light')
    expect(dataset.theme).toBe('light')
    expect(theme.accent).toBe('orange')
  })
})
