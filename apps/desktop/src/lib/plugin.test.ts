import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform/src/tauri')>()),
  invoke: () => Promise.resolve(null),
  isDesktop: false,
}))

const page = vi.hoisted(() => ({ plugin: false }))

vi.mock('./plugin', () => ({
  isPlugin: () => page.plugin,
  markPlugin: () => {
    page.plugin = true
  },
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
vi.stubGlobal('document', {
  documentElement: {
    style: { setProperty: () => undefined },
    dataset: {},
    toggleAttribute: () => false,
  },
})

let modes: typeof import('./modes.svelte').modes
let preferences: typeof import('./preferences').preferences
let sectionGroups: typeof import('./settings/sections').sectionGroups
let hiddenKinds: typeof import('./settings.svelte').hiddenKinds
let words: { experimental: string; glasses: string }

beforeAll(async () => {
  ;({ modes } = await import('./modes.svelte'))
  ;({ preferences } = await import('./preferences'))
  ;({ sectionGroups } = await import('./settings/sections'))
  const gates = await import('./settings.svelte')
  hiddenKinds = gates.hiddenKinds
  words = { experimental: gates.EXPERIMENTAL_WORD, glasses: gates.GLASSES_WORD }
}, 240_000)

function pageOf(asPlugin: boolean, on = false) {
  page.plugin = asPlugin
  modes.glassesSeen = false
  modes.restore()
  hiddenKinds.hidden = on ? [words.experimental, words.glasses] : []

  return { panes: preferences(), groups: sectionGroups() }
}

const ids = (groups: { id: string }[][]) => groups.flat().map((one) => one.id)

function glassesGroup(panes: ReturnType<typeof preferences>) {
  return panes
    .find((one) => one.id === 'experimental')
    ?.groups.find((group) => group.fields[0]?.key === 'experimental.glasses')
}

const fieldsOf = (panes: ReturnType<typeof preferences>) => glassesGroup(panes)?.fields ?? []

beforeEach(() => {
  localStorage.clear()
})

describe('the Glasses settings, in Experimental (#2027)', () => {
  for (const plugin of [false, true]) {
    test(`are a switch in Experimental, off, with no section of their own${plugin ? ' in the plugin' : ''}`, () => {
      const { panes, groups } = pageOf(plugin)

      expect(panes.map((one) => one.id)).not.toContain('glasses')
      expect(ids(groups)).not.toContain('glasses')
      expect(fieldsOf(panes).map((one) => one.key)).toEqual(['experimental.glasses'])
      const toggle = fieldsOf(panes)[0]
      expect(toggle?.kind === 'switch' && toggle.get()).toBe(false)
      expect(toggle?.kind === 'switch' && toggle.locked?.()).toBe(true)
    })
  }

  test('stay hidden for a pair that answered before, until turned on', () => {
    localStorage.setItem('orden:modes', JSON.stringify({ glassesSeen: true }))
    const { panes } = pageOf(false)

    expect(fieldsOf(panes)).toHaveLength(1)
  })

  test('show their own settings under the switch once it is on', () => {
    const { panes } = pageOf(false, true)
    const fields = fieldsOf(panes)

    expect(fields[0]?.kind === 'switch' && fields[0].get()).toBe(true)
    expect(fields.map((one) => one.label)).toContain('Line numbers')
  })

  test('carry where a page begins, and only while on', () => {
    const inside = pageOf(true, true)
    const field = fieldsOf(inside.panes).find((one) => one.kind === 'select')

    expect(field?.kind === 'select' && field.options.map((one) => one.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '0',
    ])

    const labels = pageOf(true).panes.flatMap((one) =>
      one.groups.flatMap((group) => group.fields.map((field) => field.label)),
    )
    expect(labels).not.toContain('New page at')
    expect(labels).not.toContain('Voice commands')
  })

  test('carry the line numbers as a switch, and no page number', () => {
    const fields = fieldsOf(pageOf(true, true).panes).slice(1)

    const switches = fields.filter((one) => one.kind === 'switch').map((one) => one.label)
    expect(switches[0]).toBe('Line numbers')
    expect(switches).toContain('Voice commands')
    const numbers = fields.find((one) => one.label === 'Line numbers')
    expect(numbers?.initial).toBe(true)

    expect(switches).not.toContain('Page number')
  })

  test('carry a phrase for every spoken command, as text', () => {
    const fields = fieldsOf(pageOf(true, true).panes).filter((one) => one.kind === 'text')

    expect(fields.length).toBeGreaterThan(5)
    for (const field of fields) {
      expect(field.placeholder).toBeTruthy()
    }
  })

  test('leave the same sections in the app and the plugin', () => {
    expect(ids(pageOf(false).groups)).toEqual(ids(pageOf(true).groups))
  })
})
