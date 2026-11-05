import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Unloading a tab from its menu (#1127): the rows the menu offers with the setting on,
 *  which tabs they take, and what is left of a tab once it is unloaded. The store is the
 *  real one; the disk and the pages behind the web tabs are stand-ins. */

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: () => Promise.resolve(undefined),
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
const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { pages } = await import('../web-tab/pages.svelte')
const { agentMarks } = await import('../agent-marks.svelte')
const { prompt } = await import('../prompt.svelte')
const { tabMenu } = await import('./menu')
const { mayUnload, unload, unloadEntries, unloadTabs, unloadsAround } =
  await import('./unloading.svelte')
type Tab = import('../workspace.svelte').Tab
type TabKind = import('../workspace/tab-kinds').TabKind

/** A tab of `kind` at the end of the focused pane's strip. */
function add(kind: TabKind, name: string): Tab {
  const doc = new NoteDoc({ kind, path: null, name, text: '', dirty: false }, () => undefined)
  const tab = new Tab(doc, workspace.panes.focusedId)
  workspace.tabs = [...workspace.tabs, tab]
  return tab
}

/** Three tabs, the last of them in front. */
function three(kind: TabKind = 'note'): [Tab, Tab, Tab] {
  const tabs: [Tab, Tab, Tab] = [add(kind, 'One'), add(kind, 'Two'), add(kind, 'Three')]
  for (const one of tabs) workspace.activate(one.id)
  return tabs
}

function labels(tab: Tab): string[] {
  return tabMenu(tab, tab.paneId).flatMap((row) => (row ? [row.label] : []))
}

const strip = () => workspace.tabsIn(workspace.panes.focusedId).map((one) => one.shown)

let parked: [string, boolean | undefined][] = []

beforeEach(() => {
  workspace.panes.collapse()
  workspace.tabs = []
  agentMarks.on = {}
  unloadTabs.set(true)
  parked = []
  vi.spyOn(pages, 'park').mockImplementation((id: string, hidden?: boolean) => {
    parked.push([id, hidden])
    return Promise.resolve()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the setting', () => {
  test('is off out of the box, and off the menu offers none of it', () => {
    localStorage.removeItem('nib:unload-tabs')
    unloadTabs.set(false)
    const [one] = three()

    expect(labels(one).filter((label) => label.startsWith('Unload'))).toEqual([])
  })

  test('on, a tab offers its three rows, in front of the ones that close', () => {
    const [one] = three()
    const rows = labels(one)

    expect(rows).toEqual(
      expect.arrayContaining(['Unload tab', 'Unload other tabs', 'Unload tabs to the right']),
    )
    expect(rows.indexOf('Unload tabs to the right')).toBeLessThan(rows.indexOf('Close'))
  })
})

describe('what can be unloaded', () => {
  test('is a tab whose kind comes back as it was', () => {
    for (const kind of ['note', 'canvas', 'pages', 'pdf', 'graph', 'web', 'view'] as const) {
      expect(mayUnload(add(kind, kind)), kind).toBe(true)
    }
  })

  test('is never a shell, an application, the AI panel, a private page or an agent’s tab', () => {
    for (const kind of ['terminal', 'application', 'chat'] as const) {
      const tab = add(kind, kind)
      expect(mayUnload(tab), kind).toBe(false)
      expect(unloadEntries(tab).map((row) => row?.label)).not.toContain('Unload tab')
    }

    const secret = add('web', 'Private')
    secret.inPrivate = true
    expect(mayUnload(secret)).toBe(false)

    const lent = add('note', 'Lent')
    agentMarks.on = { [lent.id]: { colour: '#f00', stopped: false } as never }
    expect(mayUnload(lent)).toBe(false)
  })

  test('is never a tab already unloaded, nor a note drawn as a column of a stacked pane', () => {
    const [one, two] = three()
    one.unloaded = true
    expect(mayUnload(one)).toBe(false)

    workspace.panes.setStacked(two.paneId, true)
    expect(mayUnload(two)).toBe(false)
    workspace.panes.setStacked(two.paneId, false)
  })

  test('around a tab leaves out what cannot go, and greys a row with nothing to take', () => {
    const one = add('note', 'One')
    const shell = add('terminal', 'Shell')
    workspace.activate(one.id)

    expect(unloadsAround(one, 'others')).toEqual([])
    expect(unloadsAround(one, 'right')).toEqual([])
    const rows = unloadEntries(one).flatMap((row) => (row ? [row] : []))
    expect(rows.find((row) => row.label === 'Unload other tabs')?.disabled).toBe(true)
    expect(rows.find((row) => row.label === 'Unload tabs to the right')?.disabled).toBe(true)
    expect(shell.unloaded).toBe(false)
  })
})

describe('a tab unloaded', () => {
  test('keeps its place and its name, and its page is parked out of sight', async () => {
    const [one, two, three_] = three('web')
    const order = strip()

    await unload(one, 'tab')

    expect(one.unloaded).toBe(true)
    expect(strip()).toEqual(order)
    expect(workspace.active).toBe(three_)
    expect(two.unloaded).toBe(false)
    expect(parked).toEqual([[one.id, true]])
  })

  test('has what it owed the disk written first', async () => {
    const [one] = three()
    const said: string[] = []
    vi.spyOn(workspace, 'flush').mockImplementation(() => void said.push('flush'))
    vi.spyOn(workspace, 'writesSettled').mockImplementation(async () => {
      said.push('settled')
      expect(one.unloaded).toBe(false)
    })

    await unload(one, 'tab')

    expect(said).toEqual(['flush', 'settled'])
    expect(one.unloaded).toBe(true)
  })

  test('in front hands the pane to the tab used before it', async () => {
    const [, two, three_] = three()

    await unload(three_, 'tab')

    expect(workspace.active).toBe(two)
    expect(three_.unloaded).toBe(true)
  })

  test('alone in its pane leaves the pane showing nothing, and stays in the strip', async () => {
    const only = add('note', 'Only')
    workspace.activate(only.id)

    await unload(only, 'tab')

    expect(workspace.active).toBeNull()
    expect(strip()).toEqual(['Only'])
    expect(only.unloaded).toBe(true)
  })

  test('is not offered again until it has been shown', async () => {
    const [one] = three()
    await unload(one, 'tab')

    expect(labels(one)).not.toContain('Unload tab')
  })
})

describe('the tabs around one', () => {
  test('Unload other tabs shows the tab it was asked on and unloads every other', async () => {
    const [one, two, three_] = three()

    await unload(one, 'others')

    expect(workspace.active).toBe(one)
    expect([one, two, three_].map((tab) => tab.unloaded)).toEqual([false, true, true])
  })

  test('Unload tabs to the right takes only those after it, a shell among them left', async () => {
    const one = add('web', 'One')
    const two = add('web', 'Two')
    const shell = add('terminal', 'Shell')
    const four = add('web', 'Four')
    workspace.activate(one.id)

    await unload(two, 'right')

    expect([one, two, shell, four].map((tab) => tab.unloaded)).toEqual([false, false, false, true])
    expect(parked).toEqual([[four.id, true]])
  })
})

describe('a page with something in it that would be lost', () => {
  test('asks first, and kept, the tab stays loaded', async () => {
    const [one] = three('web')
    vi.spyOn(pages, 'losing').mockResolvedValue(true)
    const asked = vi.spyOn(prompt, 'confirm').mockResolvedValue(false)

    await unload(one, 'tab')

    expect(asked).toHaveBeenCalledOnce()
    expect(asked.mock.calls[0]?.[0].title).toBe(`Unload ${one.shown}?`)
    expect(one.unloaded).toBe(false)
    expect(parked).toEqual([])
  })

  test('let go of, it goes the same way', async () => {
    const [one, two] = three('web')
    vi.spyOn(pages, 'losing').mockResolvedValue(true)
    vi.spyOn(prompt, 'confirm').mockResolvedValue(true)

    await unload(one, 'right')

    expect(two.unloaded).toBe(true)
    expect(parked.map(([id]) => id)).toContain(two.id)
  })

  test('and nothing is asked of a page with nothing in it', async () => {
    const [one] = three('web')
    vi.spyOn(pages, 'losing').mockResolvedValue(false)
    const asked = vi.spyOn(prompt, 'confirm')

    await unload(one, 'tab')

    expect(asked).not.toHaveBeenCalled()
    expect(one.unloaded).toBe(true)
  })
})
