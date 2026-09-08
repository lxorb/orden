import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

/** What only the plugin has.
 *
 *  The settings are the app's settings, and the app runs in four places that
 *  have no glasses anywhere near them. A section about how a note reaches a pair
 *  of glasses belongs to the one page that is in front of a pair, and `even.ts`
 *  is the only thing that says so. */

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: () => Promise.resolve(null),
  isDesktop: false,
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

/** The module graph, compiled once and outside anybody's budget: the settings
 *  pull in most of the app. See docs/conventions.md. */
beforeAll(async () => {
  await import('./preferences')
  await import('./settings/sections')
})

/** A page, with or without a pair of glasses behind it. */
async function page(asPlugin: boolean) {
  vi.resetModules()

  if (asPlugin) (await import('./plugin')).markPlugin()

  return {
    panes: (await import('./preferences')).preferences(),
    groups: (await import('./settings/sections')).sectionGroups(),
  }
}

const ids = (groups: { id: string }[][]) => groups.flat().map((one) => one.id)

beforeEach(() => {
  localStorage.clear()
})

describe('the Glasses settings', () => {
  test('are not there in the app', async () => {
    const { panes, groups } = await page(false)

    expect(panes.map((one) => one.id)).not.toContain('glasses')
    expect(ids(groups)).not.toContain('glasses')
  })

  test('are there in the plugin', async () => {
    const { panes, groups } = await page(true)

    expect(panes.map((one) => one.id)).toContain('glasses')
    expect(ids(groups)).toContain('glasses')
  })

  test('carry the display choice, and only in the plugin', async () => {
    const inside = await page(true)
    const pane = inside.panes.find((one) => one.id === 'glasses')
    const field = pane?.groups.flatMap((group) => group.fields).find((one) => one.kind === 'select')

    expect(field?.kind === 'select' && field.options.map((one) => one.value)).toEqual([
      'rendered',
      'text',
    ])

    // And nowhere to be found outside it, which is what the settings search
    // reads: the same list of panes.
    const outside = await page(false)
    const labels = outside.panes.flatMap((one) =>
      one.groups.flatMap((group) => group.fields.map((field) => field.label)),
    )
    expect(labels).not.toContain('Display')
  })

  test('leave no gap where the section was', async () => {
    // Spread into the group rather than hidden inside it, so the list closes
    // over the space instead of showing a divider with nothing under it.
    const outside = await page(false)
    const inside = await page(true)

    expect(outside.groups).toHaveLength(inside.groups.length)
    for (const group of outside.groups) expect(group.length).toBeGreaterThan(0)
    expect(ids(outside.groups).length).toBe(ids(inside.groups).length - 1)
  })
})
