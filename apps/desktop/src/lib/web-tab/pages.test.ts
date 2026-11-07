import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { Tab } from '../workspace.svelte'

interface Call {
  command: string
  args: Record<string, unknown>
}

const calls: Call[] = []

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

vi.stubGlobal('window', {})

vi.stubGlobal('requestAnimationFrame', (go: () => void) => setTimeout(go, 0))

let building: (() => void) | null = null

let refuse = false

let looked: Record<string, unknown> | null = null

let pausing: Promise<void> | null = null

let holdingLooks = false
const heldLooks: (() => void)[] = []

let refusing = false

let photographing: Promise<void> | null = null

let photo: string | null = null

let cuts: boolean | 'under' = false
const cutsOf = new Map<string, boolean | 'under'>()

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args: args ?? {} })
    if (command === 'web_pause' && pausing) await pausing
    if (command === 'web_shot' && photographing) await photographing
    if (command === 'web_shot') return photo
    if (command === 'web_pause') return !(refusing && args?.paused === true)
    if (command === 'web_look' && holdingLooks) await new Promise<void>((go) => heldLooks.push(go))
    if (command === 'web_look') {
      if (!looked) throw new Error('that page said nothing')
      return looked
    }
    if (command === 'web_place') return cutsOf.get(String(args?.tab)) ?? cuts
    if (command !== 'web_open') return undefined

    await new Promise<void>((go) => (building = go))
    if (refuse) throw new Error('no webview to be had here')
    return cutsOf.get(String(args?.tab)) ?? cuts
  },
}))

const heard = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('../own-window', () => ({
  hearHere: (name: string, tell: (event: { payload: unknown }) => void) => {
    heard.set(name, tell)
    return Promise.resolve(() => undefined)
  },
}))

const { cardCorner, pages, readChosen, readOpening } = await import('./pages.svelte')

await Promise.all([
  import('./web-data.svelte').then((one) => one.webData.merged()),
  import('./permissions.svelte'),
  import('./dialogs.svelte'),
  import('./keys'),
  import('./downloads.svelte'),
  import('./heard'),
])

const SITE = 'https://example.com/'
const PANE = { x: 0, y: 0, width: 800, height: 600 }
const MOVED = { x: 260, y: 40, width: 540, height: 600 }

async function asked(): Promise<() => void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (building) return building
    await new Promise<void>((go) => setTimeout(go, 0))
  }
  throw new Error('no page was ever asked for')
}

async function looks(): Promise<() => void> {
  for (let tries = 0; tries < 200; tries += 1) {
    const held = heldLooks.shift()
    if (held) return held
    await new Promise<void>((go) => setTimeout(go, 0))
  }
  throw new Error('no page was ever asked where it was')
}

async function hearing(name: string): Promise<(event: { payload: unknown }) => void> {
  return vi.waitFor(
    () => {
      const tell = heard.get(name)
      if (!tell) throw new Error(`nothing is listening for ${name}`)
      return tell
    },
    { timeout: 10_000 },
  )
}

async function settle(): Promise<void> {
  for (let turns = 0; turns < 5; turns += 1) await new Promise<void>((go) => setTimeout(go, 0))
}

function commands(): string[] {
  return calls.map((one) => one.command)
}

function last(command: string): Record<string, unknown> | undefined {
  return calls.filter((one) => one.command === command).at(-1)?.args
}

beforeEach(async () => {
  pages.forget('a')
  pages.forget('b')
  await settle()
  calls.length = 0
  building = null
  refuse = false
  looked = null
  holdingLooks = false
  heldLooks.length = 0
  cuts = false
  cutsOf.clear()
  localStorage.clear()
})

describe('while a page is being built', () => {
  test('an address given while a blank tab is being refused is built', async () => {
    refuse = true
    const shown = pages.show('a', '', PANE)
    const refusing = await asked()

    void pages.go('a', SITE)
    void pages.show('a', SITE, PANE)
    building = null
    refusing()
    const second = await asked()
    refuse = false
    second()
    await shown
    await settle()

    expect(commands().filter((one) => one === 'web_open')).toHaveLength(2)
    expect(last('web_open')).toMatchObject({ tab: 'a', url: SITE })
    expect(pages.of('a').live).toBe(true)
    expect(pages.of('a').openable).toBe(true)
  })

  test('a second placement asks for no second page', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()

    void pages.show('a', SITE, MOVED)
    await settle()
    expect(commands().filter((one) => one === 'web_open')).toHaveLength(1)

    arrive()
    await shown
    await settle()

    expect(last('web_place')).toMatchObject({ tab: 'a', pane: MOVED, visible: true })
  })

  test('a tab switched away from does not have its page appear over the next one', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()

    pages.hide('a', PANE)
    await settle()
    expect(commands()).toEqual(['web_open'])

    arrive()
    await shown
    await settle()

    expect(last('web_place')).toMatchObject({ tab: 'a', visible: false })
  })

  test('a tab that was closed takes its page with it', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()

    pages.forget('a')
    arrive()
    await shown
    await settle()

    expect(commands()).toEqual(['web_open', 'web_close', 'web_close'])
  })
})

test('a page the crate will not build leaves the pane its card', async () => {
  refuse = true
  const shown = pages.show('a', SITE, PANE)
  const arrive = await asked()
  arrive()
  await shown

  const page = pages.of('a')
  expect(page.openable).toBe(false)
  expect(page.live).toBe(false)
})

test('a page that was built is placed and shown', async () => {
  const shown = pages.show('a', SITE, PANE)
  const arrive = await asked()
  arrive()
  await shown

  expect(pages.of('a').live).toBe(true)
  expect(last('web_open')).toMatchObject({ tab: 'a', url: SITE, pane: PANE })
})

describe('a page asked for while something is over the pane', () => {
  test('is built anyway', async () => {
    const shown = pages.show('a', SITE, PANE, false)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    expect(commands().filter((one) => one === 'web_open')).toHaveLength(1)
    expect(pages.of('a').live).toBe(true)
  })

  test('and is put out of sight rather than over the thing that covered it', async () => {
    const shown = pages.show('a', SITE, PANE, false)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: false })
    expect(commands()).not.toContain('web_shot')
  })

  test('and where the engine cuts, it arrives with the layer cut out of it', async () => {
    cuts = true
    const over = {
      cut: { all: false, hollows: [{ x: 500, y: 520, width: 280, height: 60, radius: 8 }] },
      frame: null,
    }
    const shown = pages.show('a', SITE, PANE, false, over)
    const arrive = await asked()
    arrive()
    await shown
    await vi.waitFor(() => expect(last('web_place')).toMatchObject({ visible: true }))

    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, cut: over.cut })
    expect(calls.some((one) => one.command === 'web_place' && one.args.visible === false)).toBe(
      false,
    )
  })

  test('and is shown the moment nothing is over it any more', async () => {
    const shown = pages.show('a', SITE, PANE, false)
    const arrive = await asked()
    arrive()
    await shown
    await settle()
    calls.length = 0

    await pages.show('a', SITE, PANE, true)
    await settle()

    expect(commands()).not.toContain('web_open')
    expect(last('web_place')).toMatchObject({ tab: 'a', visible: true })
  })
})

describe('a page drawn under the app', () => {
  const over = {
    cut: { all: false, hollows: [{ x: 500, y: 520, width: 280, height: 60, radius: 8 }] },
    frame: null,
  }

  test('arrives under a layer shown, with the layer taken out of its input', async () => {
    cuts = 'under'
    const shown = pages.show('a', SITE, PANE, false, over)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    expect(pages.under).toBe(true)
    expect(pages.cuts).toBe(true)
    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: true, cut: over.cut })
    expect(calls.some((one) => one.command === 'web_place' && one.args.visible === false)).toBe(
      false,
    )
    expect(commands()).not.toContain('web_shot')
  })

  test('stays shown under a scrim, which takes all of its input, and is never photographed', async () => {
    cuts = 'under'
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    await settle()
    calls.length = 0

    await pages.show('a', SITE, PANE, false, { cut: null, frame: null })
    await settle()

    expect(last('web_place')).toMatchObject({ visible: true, cut: { all: true, hollows: [] } })
    expect(commands()).not.toContain('web_shot')
  })

  test('is told the opacity it is drawn at, and is hidden when its tab is', async () => {
    cuts = 'under'
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    await pages.show('a', SITE, PANE, true, { cut: null, frame: null, opacity: 0.5 })
    await settle()
    expect(last('web_place')).toMatchObject({ visible: true, cut: null, opacity: 0.5 })

    pages.hide('a', PANE)
    await settle()
    expect(last('web_place')).toMatchObject({ visible: false, cut: null })
  })

  test('is said for each page on its own, beside a page that is cut', async () => {
    cutsOf.set('a', 'under')
    cutsOf.set('b', true)
    for (const tab of ['a', 'b']) {
      const shown = pages.show(tab, SITE, PANE)
      const arrive = await asked()
      building = null
      arrive()
      await shown
      await settle()
    }
    expect(pages.of('a').layering).toBe('under')
    expect(pages.of('b').layering).toBe('cut')
    calls.length = 0

    await pages.show('a', SITE, PANE, false, over)
    await pages.show('b', SITE, PANE, false, over)
    await settle()

    const placed = (tab: string) =>
      calls.filter((one) => one.command === 'web_place' && one.args.tab === tab).at(-1)?.args
    expect(placed('a')).toMatchObject({ visible: true, cut: over.cut, opacity: 1 })
    expect(placed('b')).toMatchObject({ visible: true, cut: over.cut })
    expect(placed('b')).not.toHaveProperty('opacity')
    pages.forget('b')
  })

  test('an engine that says nothing of it is told no opacity', async () => {
    cuts = true
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    await pages.show('a', SITE, MOVED)
    await settle()

    expect(pages.under).toBe(false)
    expect(last('web_place')).toMatchObject({ pane: MOVED })
    expect(last('web_place')).not.toHaveProperty('opacity')
  })
})

test('a page that lands is photographed once, not once per report', async () => {
  const shown = pages.show('a', SITE, PANE)
  const arrive = await asked()
  arrive()
  await shown
  await settle()
  const moved = await hearing('nib://web-tab')
  calls.length = 0

  const said = { tab: 'a', url: SITE, title: '', back: false, forward: false }
  moved({ payload: { ...said, loading: true } })
  moved({ payload: { ...said, loading: false, title: 'Example Domain' } })
  moved({ payload: { ...said, loading: false } })
  await settle()

  expect(commands().filter((one) => one === 'web_shot')).toHaveLength(1)
})

describe("a page's mark", () => {
  const PLAIN = 'data:image/png;base64,cGxhaW4='
  const BADGED = 'data:image/png;base64,YmFkZ2Vk'
  const NEW = 'data:image/png;base64,bmV3'

  async function loaded() {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    await settle()

    const moved = await hearing('nib://web-tab')
    const iconed = await hearing('nib://web-icon')

    const load = (loading: boolean) =>
      moved({ payload: { tab: 'a', url: SITE, title: '', back: false, forward: false, loading } })
    const mark = (icon: string) => iconed({ payload: { tab: 'a', icon } })
    return { load, mark, page: pages.of('a') }
  }

  let now = 0
  beforeEach(() => {
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('the tab follows every change and the file keeps the one it arrived with', async () => {
    const { load, mark, page } = await loaded()

    load(true)
    mark(PLAIN)
    load(false)
    now += 60_000
    mark(BADGED)

    expect(page.icon).toBe(BADGED)
    expect(page.kept).toBe(PLAIN)
  })

  test('a mark set just after the load is still the one it arrived with', async () => {
    const { load, mark, page } = await loaded()

    load(true)
    mark(PLAIN)
    load(false)
    now += 1_300
    mark(NEW)

    expect(page.kept).toBe(NEW)
  })

  test('the next load brings a new mark to the file', async () => {
    const { load, mark, page } = await loaded()

    load(true)
    mark(PLAIN)
    load(false)
    now += 60_000
    load(true)
    mark(NEW)
    load(false)

    expect(page.icon).toBe(NEW)
    expect(page.kept).toBe(NEW)
  })

  test('a page with no mark leaves the tab bare and the file its own', async () => {
    const { load, mark, page } = await loaded()

    load(true)
    mark(PLAIN)
    load(false)
    now += 60_000
    load(true)
    mark('')

    expect(page.icon).toBeNull()
    expect(page.kept).toBe(PLAIN)

    mark(NEW)
    expect(page.icon).toBe(NEW)
    expect(page.kept).toBe(NEW)
  })

  test('what is not a mark is not heard', async () => {
    const { mark, page } = await loaded()
    heard.get('nib://web-icon')?.({ payload: { tab: 'a', icon: 7 } })
    heard.get('nib://web-icon')?.({ payload: null })
    expect(page.icon).toBeNull()

    mark(PLAIN)
    expect(page.icon).toBe(PLAIN)
  })
})

describe('a tab closed while its page is in front', () => {
  const FILE = '/space/A site.url'
  const PLACE = {
    url: 'https://example.com/read',
    x: 0,
    y: 640,
    trail: ['https://example.com/', 'https://example.com/read'],
    at: 1,
  }

  async function reading(): Promise<void> {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    pages.of('a').path = FILE
    looked = PLACE
    calls.length = 0
  }

  test('writes down where the reading was before the page goes', async () => {
    await reading()

    pages.forget('a')
    await settle()

    const { placeOf } = await import('./place')
    expect(placeOf(FILE)).toMatchObject({ url: PLACE.url, y: 640, at: 1 })
    expect(placeOf(FILE)?.trail).toEqual(PLACE.trail)
  })

  test('asks the page where it is before it takes the page down', async () => {
    await reading()

    pages.forget('a')
    await settle()

    expect(commands()).toEqual(['web_look', 'web_close'])
    expect(last('web_close')).toMatchObject({ tab: 'a', keep: false })
  })

  test('and closes the page anyway when it will not say where it is', async () => {
    await reading()
    looked = null

    pages.forget('a')
    await settle()

    expect(commands()).toContain('web_close')
  })
})

describe("a page's dialog still waiting", () => {
  async function waiting(): Promise<typeof import('./dialogs.svelte')> {
    const shown = pages.show('a', SITE, PANE)
    ;(await asked())()
    await shown
    const tell = await hearing('nib://web-dialog')
    tell({
      payload: { tab: 'a', id: 7, kind: 'alert', message: 'hello', text: '', origin: SITE },
    })
    const one = await import('./dialogs.svelte')
    expect(one.dialogs.open.map((dialog) => dialog.id)).toEqual([7])
    calls.length = 0
    return one
  }

  test('is let go before the page is sent elsewhere', async () => {
    const { dialogs } = await waiting()

    await pages.go('a', 'https://elsewhere.example/')
    await settle()

    expect(dialogs.open).toEqual([])
    expect(commands().sort()).toEqual(['web_dialog_answer', 'web_navigate'])
    expect(last('web_dialog_answer')).toMatchObject({ id: 7, accept: false })
  })

  test('is let go before the page is reloaded, but not when it is only stopped', async () => {
    const { dialogs } = await waiting()

    await pages.step('a', 'stop')
    await settle()
    expect(dialogs.open.map((dialog) => dialog.id)).toEqual([7])

    await pages.step('a', 'reload')
    await settle()
    expect(dialogs.open).toEqual([])
    expect(commands().sort()).toEqual(['web_dialog_answer', 'web_step', 'web_step'])
  })
})

describe('a tab that has closed', () => {
  test('is not given a page again by anything that asks after it', async () => {
    const shown = pages.show('closed', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown

    pages.forget('closed')
    await settle()
    pages.of('closed').shot = 'data:image/webp;base64,'
    await pages.go('closed', 'https://example.com/later')

    expect(pages.peek('closed')).toBeUndefined()
    expect(pages.each().map(([id]) => id)).not.toContain('closed')
    expect(commands()).not.toContain('web_navigate')
  })

  test('nor when it closed before its page was ever asked for', () => {
    pages.forget('never')
    pages.of('never').title = 'late'

    expect(pages.peek('never')).toBeUndefined()
  })
})

describe('where a page keeps what the site stores', () => {
  test('a private page is built private, in the store every space shares', async () => {
    const page = pages.of('private')
    page.inPrivate = true
    page.space = 'w'
    const shown = pages.show('private', SITE, PANE)
    ;(await asked())()
    await shown
    expect(last('web_open')).toMatchObject({
      tab: 'private',
      profile: { store: null, private: true },
    })
    pages.forget('private')
  })

  test('in the store every page shares, until its web note keeps its own', async () => {
    pages.of('a').space = 'w'
    const shown = pages.show('a', SITE, PANE)
    ;(await asked())()
    await shown

    expect(last('web_open')).toMatchObject({ tab: 'a', profile: { store: null, private: false } })
  })

  test('a web note kept apart is built in its own store', async () => {
    pages.of('apart').own = '3f9a0c17e2b4d685'
    const shown = pages.show('apart', SITE, PANE)
    ;(await asked())()
    await shown

    expect(last('web_open')).toMatchObject({
      tab: 'apart',
      profile: { store: 'note_3f9a0c17e2b4d685', private: false },
    })
    pages.forget('apart')
  })

  test('a note turned apart builds its open page again in its own store, and says so', async () => {
    for (const tab of ['a', 'b']) {
      const shown = pages.show(tab, SITE, PANE)
      ;(await asked())()
      building = null
      await shown
    }
    calls.length = 0

    const rebuilt = pages.rehouse('a', '3f9a0c17e2b4d685', 'kept apart')
    ;(await asked())()
    await rebuilt
    await settle()

    expect(calls.filter((one) => one.command === 'web_close').map((one) => one.args.tab)).toEqual([
      'a',
    ])
    expect(last('web_open')).toMatchObject({
      tab: 'a',
      profile: { store: 'note_3f9a0c17e2b4d685' },
      pane: PANE,
    })
    expect(pages.of('a').notice).toBe('kept apart')
    pages.of('a').own = null
  })

  test('a note turned apart twice at once is moved once, and its new page stays', async () => {
    const shown = pages.show('a', SITE, PANE)
    ;(await asked())()
    building = null
    await shown
    calls.length = 0
    holdingLooks = true

    const fromMenu = pages.rehouse('a', '3f9a0c17e2b4d685', 'kept apart')
    const fromPane = pages.rehouse('a', '3f9a0c17e2b4d685', 'kept apart')
    ;(await looks())()
    const rebuilt = await asked()
    holdingLooks = false
    for (const go of heldLooks.splice(0)) go()
    await settle()
    rebuilt()
    await Promise.all([fromMenu, fromPane])
    await settle()

    const said = commands()
    expect(said.filter((one) => one === 'web_open')).toHaveLength(1)
    expect(said.filter((one) => one === 'web_close')).toHaveLength(1)
    expect(said.lastIndexOf('web_close')).toBeLessThan(said.lastIndexOf('web_open'))
    expect(last('web_open')).toMatchObject({ profile: { store: 'note_3f9a0c17e2b4d685' } })
    expect(pages.of('a').live).toBe(true)
    expect(pages.of('a').notice).toBe('kept apart')
  })

  test('a pane that looks again while its page moves gets the one page', async () => {
    const shown = pages.show('a', SITE, PANE)
    ;(await asked())()
    building = null
    await shown
    calls.length = 0
    holdingLooks = true

    const moving = pages.rehouse('a', '3f9a0c17e2b4d685')
    ;(await looks())()
    holdingLooks = false
    await vi.waitFor(() => expect(pages.of('a').live).toBe(false))
    const looking = pages.show('a', SITE, MOVED)
    ;(await asked())()
    await Promise.all([moving, looking])
    await settle()

    expect(commands().filter((one) => one === 'web_open')).toHaveLength(1)
    expect(last('web_open')).toMatchObject({ profile: { store: 'note_3f9a0c17e2b4d685' } })
    expect(pages.of('a').live).toBe(true)
  })

  test('a note turned apart while its page is on its way is moved once it arrives', async () => {
    const shown = pages.show('a', SITE, PANE)
    const first = await asked()
    building = null
    void pages.rehouse('a', '3f9a0c17e2b4d685', 'kept apart')
    first()
    await shown
    ;(await asked())()
    await settle()

    const opened = calls.filter((one) => one.command === 'web_open')
    expect(opened.map((one) => (one.args.profile as { store: unknown }).store)).toEqual([
      null,
      'note_3f9a0c17e2b4d685',
    ])
    expect(pages.of('a').live).toBe(true)
  })

  test('a rehouse that leaves a page in the store it was built in loads nothing again', async () => {
    const shown = pages.show('a', SITE, PANE)
    ;(await asked())()
    await shown
    calls.length = 0

    await pages.rehouse('a', null, 'nothing moved')
    await settle()

    expect(commands()).not.toContain('web_close')
    expect(pages.of('a').live).toBe(true)
    expect(pages.of('a').notice).toBeNull()
  })
})

describe('a page out of sight', () => {
  const TABS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']
  const MINUTES = 60_000

  afterEach(async () => {
    pausing = null
    refusing = false
    photographing = null
    photo = null
    for (const tab of TABS) pages.forget(tab)
    const { saver } = await import('./saver.svelte')
    saver.set('off')
    await settle()
  })

  async function built(tab: string, url = SITE): Promise<void> {
    building = null
    const shown = pages.show(tab, url, PANE)
    ;(await asked())()
    await shown
  }

  function away(tab: string, minutes: number): void {
    pages.hide(tab, PANE)
    pages.of(tab).looked = Date.now() - minutes * MINUTES
  }

  function lulls(tab: string): unknown[] {
    return calls
      .filter((one) => one.command === 'web_pause' && one.args.tab === tab)
      .map((one) => one.args.paused)
  }

  async function memorySaver(mode: 'off' | 'moderate' | 'balanced' | 'maximum'): Promise<void> {
    const { saver } = await import('./saver.svelte')
    saver.set(mode)
  }

  test('is never parked for the old cap or the old half hour, unless Memory saver says', async () => {
    for (const tab of TABS) {
      await built(tab)
      away(tab, 600)
    }
    pages.retime()

    await vi.waitFor(() => expect(TABS.map((tab) => lulls(tab))).toEqual(TABS.map(() => [true])))
    expect(commands()).not.toContain('web_close')
    expect(TABS.every((tab) => pages.of(tab).live)).toBe(true)
  })

  test('is frozen five minutes after it went out of sight, and not before', async () => {
    await built('t0')
    away('t0', 4)
    pages.retime()
    await settle()
    expect(lulls('t0')).toEqual([])

    pages.of('t0').looked = Date.now() - 5 * MINUTES
    pages.retime()
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
  })

  test('is never frozen while it plays, was heard a moment ago, may be in a call or may notify', async () => {
    const { grants, siteOf } = await import('./permissions.svelte')
    const CALL = 'https://call.example.com/'
    const CHAT = 'https://chat.example.com/'
    grants.remember(siteOf(CALL), 'camera', 'allow')
    grants.remember(siteOf(CHAT), 'notifications', 'allow')
    await built('t0')
    await built('t1')
    await built('t2', CALL)
    await built('t3', CHAT)
    await built('t4')
    pages.of('t0').playing = true
    pages.of('t1').heard = Date.now() - 2 * MINUTES
    for (const tab of ['t0', 't1', 't2', 't3', 't4']) away(tab, 30)
    pages.retime()

    await vi.waitFor(() => expect(lulls('t4')).toEqual([true]))
    expect(['t0', 't1', 't2', 't3'].map((tab) => lulls(tab))).toEqual([[], [], [], []])
    grants.remember(siteOf(CALL), 'camera', null)
    grants.remember(siteOf(CHAT), 'notifications', null)
  })

  test('is never frozen while an agent is acting in it', async () => {
    const { agentMarks } = await import('../agent-marks.svelte')
    await built('t0')
    await built('t1')
    agentMarks.on = { t0: { agent: 'claude', colour: '#000', stopped: false } }
    away('t0', 30)
    away('t1', 30)
    pages.retime()

    await vi.waitFor(() => expect(lulls('t1')).toEqual([true]))
    expect(lulls('t0')).toEqual([])
    agentMarks.on = {}
  })

  test('the page on screen is never frozen, however long it has been looked at', async () => {
    await built('t0')
    pages.of('t0').looked = Date.now() - 60 * MINUTES
    pages.freeze('t0')
    pages.retime()
    await settle()

    expect(lulls('t0')).toEqual([])
  })

  test('comes back as it was: woken before it is placed, never built again', async () => {
    await built('t0')
    away('t0', 30)
    pages.retime()
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
    calls.length = 0

    await pages.show('t0', SITE, PANE)

    expect(commands()).toEqual(['web_pause', 'web_place'])
    expect(last('web_pause')).toMatchObject({ tab: 't0', paused: false })
    expect(last('web_place')).toMatchObject({ tab: 't0', visible: true })
  })

  test('a thaw waits for a freeze still on its way, so the page shown is never hidden', async () => {
    await built('t0')
    let answer = (): void => undefined
    pausing = new Promise<void>((go) => (answer = go))
    away('t0', 30)
    pages.retime()
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))

    const showing = pages.show('t0', SITE, PANE)
    await settle()
    expect(lulls('t0')).toEqual([true])
    expect(last('web_place')?.visible).toBe(false)

    pausing = null
    answer()
    await showing

    const order = calls
      .filter((one) => one.command === 'web_pause' || one.command === 'web_place')
      .slice(-3)
      .map((one) => `${one.command} ${String(one.args.paused ?? one.args.visible)}`)
    expect(order).toEqual(['web_pause true', 'web_pause false', 'web_place true'])
  })

  test('a swipe begun over a page puts an old picture aside and takes a fresh one', async () => {
    await built('t0')
    const page = pages.of('t0')
    page.shot = 'data:image/png;base64,old'
    page.shotAt = Date.now() - 5_000
    calls.length = 0
    pages.freshen('t0')
    expect(page.shot).toBeNull()
    expect(commands()).toContain('web_shot')

    page.shot = 'data:image/png;base64,new'
    page.shotAt = Date.now()
    calls.length = 0
    pages.freshen('t0')
    expect(page.shot).toBe('data:image/png;base64,new')
    expect(commands()).not.toContain('web_shot')
  })

  test('a page left while it is being photographed is hidden once the picture is in', async () => {
    await built('t0')
    let landed = (): void => undefined
    photographing = new Promise<void>((go) => (landed = go))
    pages.of('t0').shot = null
    const shooting = pages.shoot('t0')
    calls.length = 0

    pages.hide('t0', PANE)
    await settle()
    const out = calls.filter((one) => one.command === 'web_place')
    expect(out).toHaveLength(1)
    expect(out[0]?.args).toMatchObject({ visible: true, pane: { x: -20_000, y: -20_000 } })

    landed()
    await shooting
    await settle()
    expect(last('web_place')).toMatchObject({ tab: 't0', pane: PANE, visible: false })
  })

  test('a picture the engine took longer over than the clock stands in once it lands', async () => {
    await built('t0')
    let landed = (): void => undefined
    photographing = new Promise<void>((go) => (landed = go))
    photo = 'data:image/png;base64,late'
    pages.of('t0').shot = null

    await pages.shoot('t0')
    expect(pages.of('t0').shot).toBeNull()

    landed()
    await settle()
    expect(pages.of('t0').shot).toBe('data:image/png;base64,late')
  })

  test('a late picture of a page that has gone elsewhere since is not kept', async () => {
    await built('t0')
    let landed = (): void => undefined
    photographing = new Promise<void>((go) => (landed = go))
    photo = 'data:image/png;base64,late'
    pages.of('t0').shot = null
    await pages.shoot('t0')

    pages.of('t0').url = 'https://example.org/'
    landed()
    await settle()
    expect(pages.of('t0').shot).toBeNull()
  })

  test('a freeze the engine refused leaves the page running, and is asked again later', async () => {
    await built('t0')
    refusing = true
    away('t0', 30)
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
    await settle()

    expect(pages.of('t0').frozen).toBe(false)
    expect(pages.of('t0').resting).toBeDefined()
    calls.length = 0
    await pages.show('t0', SITE, PANE)
    expect(commands()).toEqual(['web_place'])
  })

  test("Hidden tabs' Pause and the countdown are one freeze: never twice, woken once", async () => {
    await built('t0')
    away('t0', 0)
    pages.freeze('t0')
    pages.freeze('t0')
    pages.of('t0').looked = Date.now() - 30 * MINUTES
    pages.retime()
    await settle()
    await settle()
    expect(lulls('t0')).toEqual([true])

    await pages.thaw('t0')
    await pages.show('t0', SITE, PANE)
    expect(lulls('t0')).toEqual([true, false])
  })

  describe('with Memory saver on', () => {
    test('the pages out of sight beyond its count are parked, looked at longest ago first', async () => {
      await memorySaver('maximum')
      for (const [at, tab] of TABS.entries()) {
        await built(tab)
        away(tab, 20 - at)
      }

      await vi.waitFor(() =>
        expect(calls.filter((one) => one.command === 'web_close').map((one) => one.args)).toEqual([
          { tab: 't0', keep: true },
          { tab: 't1', keep: true },
        ]),
      )
    })

    test('a page out of sight for its time is parked, keeping its trail', async () => {
      await memorySaver('maximum')
      await built('t0')
      away('t0', 29)
      pages.retime()
      await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
      expect(commands()).not.toContain('web_close')

      pages.of('t0').looked = Date.now() - 31 * MINUTES
      pages.retime()
      await vi.waitFor(() => expect(last('web_close')).toEqual({ tab: 't0', keep: true }))
      expect(pages.of('t0').live).toBe(false)
    })

    test('never a page on screen, nor one under a menu, however many there are', async () => {
      await memorySaver('maximum')
      for (const tab of TABS) await built(tab)
      await pages.show('t0', SITE, PANE, false)
      for (const tab of TABS) pages.of(tab).looked = Date.now() - 600 * MINUTES
      pages.retime()
      await settle()

      expect(pages.of('t0').shown).toBe(false)
      expect(commands()).not.toContain('web_close')
    })

    test('never one with something typed into it', async () => {
      await memorySaver('maximum')
      looked = { url: SITE, x: 0, y: 0, trail: [SITE], at: 0, edited: true }
      await built('t0')
      away('t0', 60)
      await vi.waitFor(() => expect(pages.of('t0').edited).toBe(true))
      looked = { url: SITE, x: 0, y: 0, trail: [SITE], at: 0, edited: false }
      await built('t2')
      away('t2', 60)
      pages.retime()

      await vi.waitFor(() => expect(last('web_close')).toEqual({ tab: 't2', keep: true }))
      expect(calls.filter((one) => one.command === 'web_close')).toHaveLength(1)
    })
  })
})

describe('what a page asking for a window says', () => {
  test('carries whether the tab goes behind', () => {
    expect(readOpening({ tab: 't', url: 'https://example.com/', behind: true })).toEqual({
      tab: 't',
      url: 'https://example.com/',
      behind: true,
    })
  })

  test('is in front when it does not say, as a crate from before this said nothing', () => {
    expect(readOpening({ tab: 't', url: 'https://example.com/' })?.behind).toBe(false)
    expect(readOpening({ tab: 't', url: 'https://example.com/', behind: 'yes' })?.behind).toBe(
      false,
    )
  })

  test('names nothing a tab may not hold', () => {
    expect(readOpening({ tab: 't', url: 'file:///C:/Windows/', behind: true })).toBeNull()
    expect(readOpening({ url: 'https://example.com/' })).toBeNull()
    expect(readOpening({ tab: 't', url: 'chrome-extension://short/page.html' })).toBeNull()
  })

  test("names an extension's own page, which its popup opens as a tab (#1161)", () => {
    const page = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/dashboard.html'
    expect(readOpening({ tab: 't', url: page })).toEqual({ tab: 't', url: page, behind: false })
  })
})

describe("the card's corner a page is placed with", () => {
  function frame(radius: string) {
    const panes = {}
    Object.assign(globalThis, {
      document: { querySelector: (selector: string) => (selector === 'main' ? panes : null) },
      getComputedStyle: (of: object) => ({
        getPropertyValue: (token: string) =>
          of === panes && token === '--card-radius' ? radius : '',
      }),
    })
  }

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'getComputedStyle')
  })

  test('is the token where the panes are, and nothing for a square card', () => {
    frame('10px')
    expect(cardCorner()).toBe(10)
    frame('0px')
    expect(cardCorner()).toBe(0)
    frame('')
    expect(cardCorner()).toBe(0)
  })

  test('goes with every placement, nothing where there is no frame to read', async () => {
    const shown = pages.show('round', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    void pages.place('round', MOVED, true)
    await vi.waitFor(() =>
      expect(last('web_place')).toMatchObject({ tab: 'round', pane: MOVED, corner: 0 }),
    )
  })

  test("is its own pane's foot, square where that pane stands on the window's bottom", () => {
    const card = {}
    const hole = { closest: (selector: string) => (selector === '[data-pane]' ? card : null) }
    const foot = (radius: string) =>
      Object.assign(globalThis, {
        document: { querySelector: () => null },
        getComputedStyle: (of: object) => ({
          getPropertyValue: (token: string) =>
            of === card && token === '--card-foot' ? radius : '10px',
        }),
      })
    foot('10px')
    expect(cardCorner(hole as unknown as Element)).toBe(10)
    foot('0px')
    expect(cardCorner(hole as unknown as Element)).toBe(0)
  })

  test("goes with the placement as its pane says it, over the window's own", async () => {
    frame('10px')
    const shown = pages.show('foot', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    void pages.place('foot', MOVED, true, false, { cut: null, frame: null, corner: 0 })
    await vi.waitFor(() =>
      expect(last('web_place')).toMatchObject({ tab: 'foot', pane: MOVED, corner: 0 }),
    )
    void pages.place('foot', PANE, true)
    await vi.waitFor(() =>
      expect(last('web_place')).toMatchObject({ tab: 'foot', pane: PANE, corner: 10 }),
    )
  })
})

describe('a page a person presses in or types into', () => {
  let did: string[] = []
  let inFront = 'a'

  beforeEach(async () => {
    did = []
    inFront = 'a'
    const { workspace } = await import('../workspace.svelte')
    vi.spyOn(workspace, 'activeTabId', 'get').mockImplementation(() => inFront)
    vi.spyOn(workspace, 'tabs', 'get').mockReturnValue([{ id: 'a' }, { id: 'b' }] as Tab[])
    vi.spyOn(workspace, 'activate').mockImplementation((id) => {
      did.push(`activate ${id}`)
      inFront = id
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('makes its tab, in the other pane, the one being worked in', async () => {
    const shown = pages.show('b', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown

    const chosen = await hearing('nib://web-chosen')
    chosen({ payload: { tab: 'b' } })
    await vi.waitFor(() => expect(did).toEqual(['activate b']))

    chosen({ payload: { tab: 'b' } })
    await settle()
    expect(did).toEqual(['activate b'])
  })

  test('chooses no tab it does not hold, and reads nothing else as one', async () => {
    const chosen = await hearing('nib://web-chosen')
    chosen({ payload: { tab: 'elsewhere' } })
    chosen({ payload: {} })
    await settle()
    expect(did).toEqual([])
    expect(readChosen({ tab: 'b' })).toBe('b')
    expect(readChosen({ tab: 3 })).toBeNull()
    expect(readChosen(null)).toBeNull()
  })
})

describe('a tab that closes itself when its download starts', () => {
  const FILE = 'https://example.com/slides.pdf'

  let did: string[] = []
  let inFront = 'b'

  beforeEach(async () => {
    did = []
    inFront = 'b'
    const { workspace } = await import('../workspace.svelte')
    vi.spyOn(workspace, 'activeTabId', 'get').mockImplementation(() => inFront)
    vi.spyOn(workspace, 'tabs', 'get').mockReturnValue([{ id: 'a' }, { id: 'b' }] as Tab[])
    vi.spyOn(workspace, 'openPage').mockImplementation((_url, _ask, opener) => {
      did.push(`open from ${opener ?? ''}`)
      return 'b'
    })
    vi.spyOn(workspace, 'activate').mockImplementation((id) => void did.push(`activate ${id}`))
    vi.spyOn(workspace, 'close').mockImplementation((id) => void did.push(`close ${id}`))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function downloadFromB(id: number): Promise<void> {
    const shownA = pages.show('a', SITE, PANE)
    const arriveA = await asked()
    arriveA()
    await shownA

    const opening = await hearing('nib://web-open')
    opening({ payload: { tab: 'a', url: FILE } })
    await settle()

    building = null
    const shownB = pages.show('b', FILE, PANE)
    const arriveB = await asked()
    arriveB()
    await shownB
    await settle()

    const download = await hearing('nib://web-download')
    download({ payload: { id, tab: 'b', url: FILE, name: 'slides.pdf', state: 'going' } })
  }

  test('hands the keyboard to the app when the tab in front closes itself', async () => {
    await downloadFromB(1)

    await vi.waitFor(() => expect(did).toEqual(['open from a', 'activate a', 'close b']))
    expect(commands()).toContain('take_keyboard')
  })

  test('leaves the keyboard where it was when the tab behind closes itself', async () => {
    inFront = 'a'
    await downloadFromB(2)

    await vi.waitFor(() => expect(did).toContain('close b'))
    expect(commands()).not.toContain('take_keyboard')
  })
})

describe('a page whose process died', () => {
  async function livePage(tab: string) {
    const shown = pages.show(tab, SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
  }

  const crash = async (tab: string) => {
    const page = await hearing('nib://web-page')
    page({ payload: { tab, said: 'crashed' } })
    await settle()
  }

  test('goes, keeps its trail, and is not built again on its own', async () => {
    await livePage('crashing')
    calls.length = 0

    await crash('crashing')
    const page = pages.of('crashing')
    expect(page.crashed).toBe(true)
    expect(page.live).toBe(false)
    expect(calls).toContainEqual({ command: 'web_close', args: { tab: 'crashing', keep: true } })

    calls.length = 0
    await pages.show('crashing', SITE, PANE)
    expect(commands()).not.toContain('web_open')
  })

  test('comes back with Reload', async () => {
    await livePage('reloading')
    await crash('reloading')

    await pages.step('reloading', 'reload')
    expect(pages.of('reloading').crashed).toBe(false)

    calls.length = 0
    building = null
    const shown = pages.show('reloading', SITE, PANE)
    const arrive = await asked()
    expect(commands()).toContain('web_open')
    arrive()
    await shown
    expect(pages.of('reloading').live).toBe(true)
  })

  test('comes back with an address typed over it', async () => {
    await livePage('typed')
    await crash('typed')

    await pages.go('typed', 'https://example.org/')
    expect(pages.of('typed').crashed).toBe(false)
  })

  test('during its build is not lost', async () => {
    const shown = pages.show('early', SITE, PANE)
    const arrive = await asked()
    await crash('early')
    arrive()
    await shown
    await settle()

    const page = pages.of('early')
    expect(page.crashed).toBe(true)
    expect(page.live).toBe(false)
    expect(calls).toContainEqual({ command: 'web_close', args: { tab: 'early', keep: true } })
  })

  test('Reload closes what may be left of it first', async () => {
    await livePage('left')
    await crash('left')
    calls.length = 0

    await pages.step('left', 'reload')
    expect(calls).toContainEqual({ command: 'web_close', args: { tab: 'left', keep: true } })
    expect(pages.of('left').crashed).toBe(false)
  })

  test('one that did not arrive goes the same way, says why, and comes back with Reload', async () => {
    await livePage('failing')
    calls.length = 0
    const page = await hearing('nib://web-page')
    page({
      payload: {
        tab: 'failing',
        said: 'arrived',
        url: 'https://no-such-host.invalid/',
        failure: 'other',
        bare: true,
        reason: 'A server with the specified hostname could not be found.',
      },
    })
    await settle()

    const failed = pages.of('failing')
    expect(failed.crashed).toBe(true)
    expect(failed.live).toBe(false)
    expect(failed.loading).toBe(false)
    expect(failed.url).toBe('https://no-such-host.invalid/')
    expect(failed.failure).toEqual({
      url: 'https://no-such-host.invalid/',
      failure: 'other',
      reason: 'A server with the specified hostname could not be found.',
    })
    expect(calls).toContainEqual({ command: 'web_close', args: { tab: 'failing', keep: true } })

    await pages.step('failing', 'reload')
    expect(failed.crashed).toBe(false)
    expect(failed.failure).toBe(null)
  })

  test('one the engine could not say the address of keeps the tab where it was going', async () => {
    await livePage('nameless')
    const page = await hearing('nib://web-page')
    page({
      payload: { tab: 'nameless', said: 'arrived', url: '', failure: 'other', bare: true },
    })
    await settle()
    const failed = pages.of('nameless')
    expect(failed.crashed).toBe(true)
    expect(failed.url).toBe(SITE)
    expect(failed.failure?.url).toBe(SITE)
  })

  test('one an engine drew its own page for stays', async () => {
    await livePage('drawn')
    const page = await hearing('nib://web-page')
    page({
      payload: { tab: 'drawn', said: 'arrived', url: SITE, failure: 'other', bare: false },
    })
    await settle()
    expect(pages.of('drawn').live).toBe(true)
    expect(pages.of('drawn').failure).toBe(null)
  })

  test('a build that is refused after Reload offers Reload again', async () => {
    await livePage('refused')
    await crash('refused')
    await pages.step('refused', 'reload')

    building = null
    refuse = true
    const shown = pages.show('refused', SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    refuse = false

    expect(pages.of('refused').crashed).toBe(true)
    expect(pages.of('refused').openable).toBe(true)
  })

  test('a page on its way out says so to nobody', async () => {
    await livePage('parked')
    await pages.park('parked')
    await crash('parked')
    expect(pages.of('parked').crashed).toBe(false)
  })
})

describe('a page parked out of sight', () => {
  async function livePage(tab: string) {
    const shown = pages.show(tab, SITE, PANE)
    const arrive = await asked()
    arrive()
    await shown
    building = null
  }

  test('keeps its page when its tab is shown again while it is asked where it is', async () => {
    await livePage('chosen')
    pages.hide('chosen', PANE)
    await settle()
    calls.length = 0
    holdingLooks = true

    const parking = pages.park('chosen', true)
    const answer = await looks()
    holdingLooks = false
    const shown = pages.show('chosen', SITE, PANE)
    answer()
    await Promise.all([parking, shown])

    expect(pages.of('chosen').live).toBe(true)
    expect(commands()).not.toContain('web_close')
    pages.forget('chosen')
  })

  test('goes, its trail kept, when nobody chose it in the meantime', async () => {
    await livePage('left')
    pages.hide('left', PANE)
    await settle()
    calls.length = 0

    await pages.park('left', true)

    expect(pages.of('left').live).toBe(false)
    expect(calls).toContainEqual({ command: 'web_close', args: { tab: 'left', keep: true } })
    pages.forget('left')
  })

  test('says first whether something typed into it would be lost', async () => {
    await livePage('typed')
    pages.hide('typed', PANE)
    await settle()

    looked = { url: SITE, x: 0, y: 0, trail: [SITE], at: 0, edited: true }
    expect(await pages.losing('typed')).toBe(true)
    looked = { url: SITE, x: 0, y: 0, trail: [SITE], at: 0, edited: false }
    expect(await pages.losing('typed')).toBe(false)
    expect(await pages.losing('nobody')).toBe(false)
    pages.forget('typed')
  })
})
