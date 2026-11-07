import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
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

beforeAll(async () => {
  ;({ modes } = await import('./modes.svelte'))
  ;({ preferences } = await import('./preferences'))
  ;({ sectionGroups } = await import('./settings/sections'))
}, 240_000)

function pageOf(asPlugin: boolean) {
  page.plugin = asPlugin
  modes.glassesSeen = false
  modes.restore()

  return { panes: preferences(), groups: sectionGroups() }
}

const ids = (groups: { id: string }[][]) => groups.flat().map((one) => one.id)

beforeEach(() => {
  localStorage.clear()
})

describe('the Glasses settings', () => {
  test('are not there in the app', () => {
    const { panes, groups } = pageOf(false)

    expect(panes.map((one) => one.id)).not.toContain('glasses')
    expect(ids(groups)).not.toContain('glasses')
  })

  test('are there in the plugin', () => {
    const { panes, groups } = pageOf(true)

    expect(panes.map((one) => one.id)).toContain('glasses')
    expect(ids(groups)).toContain('glasses')
  })

  test('are there on any device once a pair has answered', () => {
    localStorage.setItem('orden:modes', JSON.stringify({ glassesSeen: true }))
    const { panes, groups } = pageOf(false)

    expect(panes.map((one) => one.id)).toContain('glasses')
    expect(ids(groups)).toContain('glasses')
  })

  test('carry where a page begins, and only in the plugin', () => {
    const inside = pageOf(true)
    const pane = inside.panes.find((one) => one.id === 'glasses')
    const field = pane?.groups.flatMap((group) => group.fields).find((one) => one.kind === 'select')

    expect(field?.kind === 'select' && field.options.map((one) => one.value)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '0',
    ])

    const outside = pageOf(false)
    const labels = outside.panes.flatMap((one) =>
      one.groups.flatMap((group) => group.fields.map((field) => field.label)),
    )
    expect(labels).not.toContain('New page at')
    expect(labels).not.toContain('Voice commands')
  })

  test('carry the line numbers as a switch, and no page number', () => {
    const inside = pageOf(true)
    const pane = inside.panes.find((one) => one.id === 'glasses')
    const fields = pane?.groups.flatMap((group) => group.fields) ?? []

    const switches = fields.filter((one) => one.kind === 'switch').map((one) => one.label)
    expect(switches[0]).toBe('Line numbers')
    expect(switches).toContain('Voice commands')
    const numbers = fields.find((one) => one.label === 'Line numbers')
    expect(numbers?.initial).toBe(true)

    expect(switches).not.toContain('Page number')
  })

  test('carry a phrase for every spoken command, as text', () => {
    const inside = pageOf(true)
    const pane = inside.panes.find((one) => one.id === 'glasses')
    const group = pane?.groups.find((one) => one.title === 'Spoken commands')
    const fields = group?.fields ?? []

    expect(fields.length).toBeGreaterThan(5)
    for (const field of fields) {
      expect(field.kind).toBe('text')
      expect(field.kind === 'text' && field.placeholder).toBeTruthy()
    }
  })

  test('leave no gap where the section was', () => {
    const outside = pageOf(false)
    const inside = pageOf(true)

    expect(outside.groups).toHaveLength(inside.groups.length)
    for (const group of outside.groups) expect(group.length).toBeGreaterThan(0)
    expect(ids(outside.groups).length).toBe(ids(inside.groups).length - 1)
  })
})
