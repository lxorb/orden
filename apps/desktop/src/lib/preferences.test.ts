import { beforeAll, afterAll, describe, expect, test, vi } from 'vitest'
import { inLanguageOrder } from '@orden/markdown/language-order'
import type { Pane } from './preferences'

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

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const { preferences, resettable } = await import('./preferences')
const { LANGUAGES } = await import('./i18n.svelte')
const { theme } = await import('./theme.svelte')
const { DICTIONARIES } = await import('./spell-languages')

const panes = preferences()
const pane = (id: string) => {
  const found = panes.find((one) => one.id === id)
  if (!found) throw new Error(`no ${id} pane`)
  return found
}

const fieldsOf = (id: string) => pane(id).groups.flatMap((group) => group.fields)

const field = (paneId: string, label: string) => {
  const found = fieldsOf(paneId).find((one) => one.label === label)
  if (!found) throw new Error(`no ${label} on ${paneId}`)
  return found
}

function readsAsOneSentence(hint: string, label: string) {
  expect(hint, label).toMatch(/\.$/)
  expect(hint.length, label).toBeLessThan(110)
  expect(hint.replace(/\d\.(\d)?/g, ''), label).toMatch(/^[^.]*\.$/)
}

describe('the sentence behind a setting', () => {
  const every = panes.flatMap((one) => one.groups.flatMap((group) => group.fields))

  test('is there for every setting, the ones a word explains too', () => {
    expect(every.length).toBeGreaterThan(40)
    for (const one of every) expect(one.hint, one.label).toBeTruthy()
  })

  test('says more than the name does', () => {
    for (const one of every)
      expect(one.hint.toLowerCase(), one.label).not.toBe(one.label.toLowerCase())
  })

  test('is one plain sentence, which is all a tooltip has room for', () => {
    for (const one of every) readsAsOneSentence(one.hint, one.label)
  })

  test('still explains the words that explain nothing to somebody new', () => {
    expect(field('general', 'Smart dates').hint).toMatch(/dates/)
    expect(field('markdown', 'Strict CommonMark').hint).toMatch(/standard markdown/)
  })
})

describe('the Markdown pane', () => {
  test('shows the markdown while writing unless asked not to', () => {
    const shown = field('markdown', 'Show markdown while writing')
    expect(shown.kind).toBe('switch')
    expect(shown.initial).toBe(true)
  })
})

describe('the Note types pane', () => {
  test('switches each kind, in its line', () => {
    const kinds = preferences().find((one) => one.id === 'kinds')
    expect(kinds?.groups.map((group) => group.title)).toEqual(['Notes', 'Terminal', 'Web'])
    expect(kinds?.groups.flatMap((group) => group.fields.map((one) => one.label))).toEqual([
      'Note',
      'Canvas',
      'Page note',
      'Online terminal',
      'Application',
      'Web note',
    ])
    expect(kinds && resettable(kinds)).toBe(true)

    const fields = kinds?.groups.flatMap((group) => group.fields) ?? []
    for (const one of fields) expect(one.icon).toBeDefined()
    const [last, ...rest] = [...fields].reverse()
    for (const one of rest) if (one.kind === 'switch') one.set(false)

    expect(last?.kind === 'switch' && last.get()).toBe(true)
    expect(last?.kind === 'switch' && last.locked?.()).toBe(true)
    for (const one of rest) if (one.kind === 'switch') one.set(true)
    expect(last?.kind === 'switch' && last.locked?.()).toBe(false)
  })

  test('is found by the new tab and its key', async () => {
    const { search } = await import('./settings-search')
    for (const query of ['Ctrl+T', 'new tab']) {
      const hits = search(query, preferences(), [])
      expect(
        hits.some((hit) => hit.kind === 'field' && hit.pane.id === 'kinds'),
        query,
      ).toBe(true)
    }
  })
})

describe('the Appearance pane', () => {
  test('chooses the theme with a dropdown, the built-in first', () => {
    const one = field('appearance', 'Style')
    if (one.kind !== 'select') throw new Error('the theme is a dropdown')

    expect(one.options[0]).toEqual({ value: 'default', label: 'Classic' })
    expect(one.options.map((option) => option.value)).not.toContain('dark')
    expect(one.options.map((option) => option.value)).not.toContain('light')
  })

  test('and the scheme with the segmented control the app already has', () => {
    const one = field('appearance', 'Mode')
    if (one.kind !== 'segmented') throw new Error('the mode is a segmented control')

    expect(one.options).toEqual([
      { value: 'system', label: 'System', disabled: false },
      { value: 'dark', label: 'Dark', disabled: false },
      { value: 'light', label: 'Light', disabled: false },
    ])
    expect(one.get()).toBe('system')
  })

  test('disables the segments the theme in force cannot show', () => {
    theme.files = [
      { id: 'file:warm-paper', name: 'Warm Paper', variants: ['light'], path: '/warm-paper.css' },
    ]
    theme.id = 'file:warm-paper'

    try {
      const one = preferences()
        .flatMap((pane) => pane.groups.flatMap((group) => group.fields))
        .find((entry) => entry.label === 'Mode')
      if (one?.kind !== 'segmented') throw new Error('the mode is a segmented control')

      expect(one.options.map((option) => option.disabled)).toEqual([true, true, false])
      expect(one.get()).toBe('light')
    } finally {
      theme.files = []
      theme.id = 'default'
    }
  })

  test('offers no reset, since neither row is a default anybody drifted from', () => {
    expect(resettable(pane('appearance'))).toBe(false)
  })

  test('and asks two questions, contrast being a theme rather than a switch', () => {
    expect(pane('appearance').groups[0]?.fields.map((one) => one.label)).toEqual([
      'Style',
      'Mode',
      'Accent',
    ])
  })

  test('and offers the pointing hand, off by default', () => {
    const hand = fieldsOf('appearance').find((one) => one.label === 'Pointing hand on buttons')
    expect(hand?.kind).toBe('switch')
    expect(hand?.initial).toBe(false)
  })

  test('and General offers Silent mode, off by default', () => {
    const silent = fieldsOf('general').find((one) => one.label === 'Silent mode')
    expect(silent?.kind).toBe('switch')
    expect(silent?.initial).toBe(false)
  })

  test('and draws the theme’s own settings as a row apiece, in the group that chose it', () => {
    const group = pane('appearance').groups[0]
    const accent = group?.fields.find((one) => one.label === 'Accent')

    expect(accent?.kind).toBe('swatches')
    expect(accent?.kind === 'swatches' && accent.options.length).toBe(theme.accents.length)
    expect(accent?.get()).toBe(theme.accent)
  })

  test('and names each row for what it picks rather than for the group', () => {
    const group = pane('appearance').groups[0]
    expect(group?.title).toBe('Theme')
    expect(group?.fields.map((one) => one.label)).not.toContain(group?.title)
  })
})

describe('the release channel', () => {
  let desktop: Pane[] = []

  const row = () => {
    const found = desktop
      .flatMap((one) => one.groups.flatMap((group) => group.fields))
      .find((one) => one.label === 'Release channel')
    if (found?.kind !== 'segmented') throw new Error('the channel is a segmented control')

    return found
  }

  beforeAll(async () => {
    vi.resetModules()
    vi.doMock('./tauri', async (original) => ({
      ...(await original<typeof import('./tauri')>()),
      isDesktop: true,
      isNative: true,
    }))

    desktop = (await import('./preferences')).preferences()
  })

  afterAll(() => {
    vi.doUnmock('./tauri')
    vi.resetModules()
  })

  test('has the version after it, with the channel beside it', () => {
    const general = desktop.find((one) => one.id === 'general')
    const group = general?.groups.find((one) => one.fields.some((field) => field === row()))
    expect(group?.fields.map((one) => one.label)).toEqual(['Release channel', 'Version'])
    expect(group?.fields.at(-1)?.get()).toBe('under test, Stable')
  })

  test('stands in for the web version, which the desktop app has no use for', () => {
    const labels = desktop.flatMap((one) => one.groups.flatMap((group) => group.fields))
    expect(labels.map((one) => one.label)).not.toContain('Web version')
  })

  test('is offered on nothing that cannot install a version it finds', () => {
    const labels = panes.flatMap((one) => one.groups.flatMap((group) => group.fields))
    expect(labels.map((one) => one.label)).not.toContain('Release channel')
  })

  test('is the two streams as a segmented control, the releases first', () => {
    expect(row().options).toEqual([
      { value: 'stable', label: 'Stable' },
      { value: 'unstable', label: 'Unstable' },
    ])
  })

  test('starts on the releases, which is also what a reset puts back', () => {
    expect(row().get()).toBe('stable')
    expect(row().initial).toBe('stable')
  })

  test('says what the two words mean, since neither explains itself', () => {
    const hint = row().hint

    readsAsOneSentence(hint, 'Release channel')
    expect(hint).toContain('Stable')
    expect(hint).toContain('Unstable')
    expect(hint).toContain('break')
  })

  test('is a group of its own under General, where the app itself is set up', () => {
    const general = desktop.find((one) => one.id === 'general')
    const group = general?.groups.find((one) => one.fields.some((field) => field === row()))

    expect(group?.title).toBe('Updates')
  })
})

describe('the web version', () => {
  const row = () => {
    const found = fieldsOf('general').find((one) => one.label === 'Web version')
    if (found?.kind !== 'segmented') throw new Error('the web version is a segmented control')

    return found
  }

  test('is the two builds, the release first, in a group of its own under General', () => {
    expect(row().options).toEqual([
      { value: 'stable', label: 'Stable' },
      { value: 'unstable', label: 'Unstable' },
    ])
    const group = pane('general').groups.find((one) => one.fields.includes(row()))
    expect(group?.title).toBe('Updates')
  })

  test('says the build that is running, which outside the edge is the release', () => {
    expect(row().get()).toBe('stable')
    expect(row().initial).toBe('stable')
  })

  test('says what the two words mean, and which of them can break', () => {
    const hint = row().hint
    expect(hint).toContain('Stable')
    expect(hint).toContain('Unstable')
    expect(hint).toContain('break')
  })
})

describe('the version', () => {
  test('is the last row of Updates under General, said beside the build the browser runs', () => {
    const group = pane('general').groups.find((one) => one.title === 'Updates')
    const last = group?.fields.at(-1)
    expect(last?.label).toBe('Version')
    expect(last?.kind).toBe('value')
    expect(last?.get()).toBe('under test (c0ffee1), Stable')
    expect(last?.words).toEqual(expect.arrayContaining(['version', 'about']))
  })
})

describe('the language picker', () => {
  const SAID = 'Machine-translated. Corrections welcome.'

  const row = () => {
    const one = field('general', 'Language')
    if (one.kind !== 'select') throw new Error('the language is a dropdown')
    return one
  }

  test('offers every language the app has a catalogue for', () => {
    expect(row().options.map((one) => one.value)).toEqual(LANGUAGES.map((one) => one.id))
  })

  test('marks every catalogue nobody has read through', () => {
    const marked = row()
      .options.filter((one) => one.note)
      .map((one) => one.value)

    expect(marked).toEqual(LANGUAGES.filter((one) => one.machine).map((one) => one.id))
    expect(marked.length).toBeGreaterThan(30)
  })

  test('and leaves the hand-written ones plain', () => {
    const plain = row()
      .options.filter((one) => !one.note)
      .map((one) => one.value)

    expect(plain).toEqual(['system', 'de', 'en', 'fr', 'gsw', 'ja'])
  })

  test('says the same thing on every marked row, in the caption’s own words', () => {
    const said = new Set(row().options.flatMap((one) => (one.note ? [one.note] : [])))
    expect([...said]).toEqual([SAID])
  })
})

describe('the spelling dictionaries', () => {
  test('are offered in the order every language list keeps', () => {
    expect([...DICTIONARIES]).toEqual(inLanguageOrder(DICTIONARIES))
  })

  test('are the platform’s where Orden cannot choose them, and the pane says so', () => {
    const spelling = pane('spelling')
    expect(spelling.groups.flatMap((group) => group.fields).map((one) => one.label)).toEqual([
      'Check spelling',
    ])
    expect(spelling.groups[0]?.caption?.text).toMatch(/system or browser/)
  })
})
