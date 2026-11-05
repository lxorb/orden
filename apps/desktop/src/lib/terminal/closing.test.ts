import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** #1110: an online terminal saved nowhere asks, as its tab closes, whether its session
 *  ends or keeps running; one saved in the sidebar closes without a word. The store is
 *  the real one, so every close below goes the way a press of the cross, Ctrl+W, Close
 *  others or a pane's close goes; the question sheet and the account's calls are
 *  stand-ins. */

const world = vi.hoisted(() => ({
  answer: null as string | null,
  asked: [] as { title: string; options: string[] }[],
  ended: [] as string[],
}))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('../prompt.svelte', () => ({
  prompt: {
    choose: (options: { title: string; options: { id: string }[] }) => {
      world.asked.push({ title: options.title, options: options.options.map((one) => one.id) })
      return Promise.resolve(world.answer)
    },
    confirm: () => Promise.resolve(true),
  },
}))
vi.mock('../online/calls', () => ({
  endSession: (id: string) => {
    world.ended.push(id)
    return Promise.resolve()
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../workspace.svelte')

/** A new online terminal's tab, as `openOnline` opens it: its words name its session. */
function online(session: string, name = 'Terminal') {
  return workspace.openUnsaved(
    'terminal',
    JSON.stringify({ v: 1, machine: 'machine-1', session }),
    name,
  )
}

const open = (id: string) => workspace.tabs.some((one) => one.id === id)

beforeEach(() => {
  workspace.panes.collapse()
  workspace.tabs = []
  world.answer = null
  world.asked = []
  world.ended = []
})

describe('an online terminal saved nowhere, closed', () => {
  test('asks once whether to end its session, Keep running the safe answer', async () => {
    const tab = online('s-1', 'Build')
    world.answer = 'keep'
    await workspace.closeAsking(tab.id)
    expect(world.asked).toEqual([{ title: 'End Build?', options: ['cancel', 'end', 'keep'] }])
    expect(open(tab.id)).toBe(false)
    expect(world.ended).toEqual([])
  })

  test('ends its session on the machine when End is the answer', async () => {
    const tab = online('s-2')
    world.answer = 'end'
    await workspace.closeAsking(tab.id)
    expect(open(tab.id)).toBe(false)
    await vi.waitFor(() => expect(world.ended).toEqual(['s-2']))
  })

  test('stays open, its session too, when the question is let go of', async () => {
    const tab = online('s-3')
    world.answer = null
    await workspace.closeAsking(tab.id)
    expect(open(tab.id)).toBe(true)
    world.answer = 'cancel'
    await workspace.closeAsking(tab.id)
    expect(open(tab.id)).toBe(true)
    expect(world.ended).toEqual([])
  })

  test('is one question for every one a gesture closes', async () => {
    const one = online('s-4')
    const two = online('s-5')
    world.answer = 'end'
    await workspace.closeMany([one.id, two.id])
    expect(world.asked).toHaveLength(1)
    expect(world.asked[0]?.title).toBe('End these online terminals?')
    await vi.waitFor(() => expect(world.ended.sort()).toEqual(['s-4', 's-5']))
  })

  test('asks as Close others closes it, and as its pane closes', async () => {
    workspace.openBlank('Kept', '# Kept')
    const keep = workspace.active
    const tab = online('s-6')
    world.answer = 'keep'
    await workspace.closeAround(keep?.id ?? '', 'others')
    expect(world.asked).toHaveLength(1)
    expect(open(tab.id)).toBe(false)

    // A pane of its own beside, closed with what is in it.
    const right = workspace.panes.split('row')
    expect(right).not.toBeNull()
    const again = online('s-8')
    world.answer = 'cancel'
    await workspace.closePane(again.paneId)
    expect(world.asked).toHaveLength(2)
    expect(open(again.id)).toBe(true)
  })
})

describe('an online terminal saved in the sidebar, closed', () => {
  test('closes without a word, its session left as it is', async () => {
    const tab = online('s-7')
    tab.path = '/space/Build.term'
    await workspace.closeAsking(tab.id)
    expect(world.asked).toEqual([])
    expect(open(tab.id)).toBe(false)
    expect(world.ended).toEqual([])
  })
})

/** Every close a hand asks for goes through `mayClose`, and so through the question. */
test("the strip's, the overview's and the keys' closes all ask through the store", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const store = read('../workspace.svelte.ts')
  expect(store).toMatch(/async closeAsking[\s\S]{0,200}this\.mayClose\(\[tab\]\)/)
  expect(store).toMatch(/async closeMany[\s\S]{0,200}this\.mayClose\(going\)/)
  expect(store).toMatch(/mayEnd\(closing, this\.tabs\)/)
  expect(read('../Tabs.svelte')).toContain('workspace.closeAsking(tab.id)')
  expect(read('../overview/Overview.svelte')).toContain('workspace.closeAsking(tab.id)')
})
