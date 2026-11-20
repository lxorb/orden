import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Tab } from '../../documents/src/api'
import { memoryStorage } from '../../../../test/disk'

interface Call {
  command: string
  args: Record<string, unknown>
}
const calls: Call[] = []
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
let cuts: boolean | 'hollows' = false
let paints = true
const cutsOf = new Map<string, boolean | 'hollows'>()
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
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
    if (paints) heard.get('orden://web-painted')?.({ payload: { tab: args?.tab, url: args?.url } })
    return cutsOf.get(String(args?.tab)) ?? cuts
  },
}))
const heard = new Map<string, (event: { payload: unknown }) => void>()
vi.mock('../../windows/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../windows/src/api')>()),
  hearHere: (name: string, tell: (event: { payload: unknown }) => void) => {
    heard.set(name, tell)
    return Promise.resolve(() => undefined)
  },
}))
const { cardCorner, OUT_OF_THE_WAY, pages, readChosen, readOpening } = await import('./pages.svelte')
await Promise.all([
  import('./web-data.svelte').then((one) => one.webData.merged()),
  import('./permissions.svelte'),
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
async function built(
  tab = 'a',
  url = SITE,
  pane = PANE,
  visible = true,
  over?: Parameters<typeof pages.show>[4],
): Promise<void> {
  building = null
  const shown = pages.show(tab, url, pane, visible, over)
  ;(await asked())()
  await shown
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
  paints = true
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
  test('an address given while the page is being built is gone to once it arrives', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    void pages.go('a', 'https://example.org/')
    arrive()
    await shown
    await settle()
    expect(last('web_navigate')).toMatchObject({ tab: 'a', url: 'https://example.org/' })
    expect(pages.of('a').url).toBe('https://example.org/')
  })
  test('the address the page was built with is not gone to again', async () => {
    const shown = pages.show('a', SITE, PANE)
    const arrive = await asked()
    void pages.go('a', SITE)
    arrive()
    await shown
    await settle()
    expect(commands()).not.toContain('web_navigate')
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
  await built()
  const page = pages.of('a')
  expect(page.openable).toBe(false)
  expect(page.live).toBe(false)
})
test('a page that was built is placed and shown', async () => {
  await built()
  expect(pages.of('a').live).toBe(true)
  expect(last('web_open')).toMatchObject({ tab: 'a', url: SITE, pane: { x: -OUT_OF_THE_WAY, y: -OUT_OF_THE_WAY } })
  await settle()
  expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: true })
})
describe('a new page before it first paints', () => {
  const placedIn = () =>
    calls.some(
      (one) =>
        one.command === 'web_place' && one.args.visible === true && (one.args.pane as { x: number }).x === PANE.x,
    )
  test('is built out of the way, drawn, and takes its pane once it paints', async () => {
    paints = false
    await built()
    expect((last('web_open')?.pane as { x: number }).x).toBe(-OUT_OF_THE_WAY)
    await settle()
    expect(placedIn()).toBe(false)
    heard.get('orden://web-painted')?.({ payload: { tab: 'a', url: SITE } })
    await settle()
    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: true })
  })
  test('takes its pane a moment after its first commit, when no paint is heard', async () => {
    paints = false
    await built()
    ;(await hearing('orden://web-tab'))({
      payload: { tab: 'a', url: SITE, title: '', back: false, forward: false, loading: true },
    })
    await settle()
    expect(placedIn()).toBe(false)
    await vi.waitFor(() => expect(placedIn()).toBe(true), { timeout: 2000 })
  })
})
describe('a page asked for while something is over the pane', () => {
  test('is built anyway', async () => {
    await built('a', SITE, PANE, false)
    await settle()
    expect(commands().filter((one) => one === 'web_open')).toHaveLength(1)
    expect(pages.of('a').live).toBe(true)
  })
  test('and is put out of sight rather than over the thing that covered it', async () => {
    await built('a', SITE, PANE, false)
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
    await built('a', SITE, PANE, false, over)
    await vi.waitFor(() => expect(last('web_place')).toMatchObject({ visible: true }))
    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, cut: over.cut })
    expect(calls.some((one) => one.command === 'web_place' && one.args.visible === false)).toBe(false)
  })
  test('and is shown the moment nothing is over it any more', async () => {
    await built('a', SITE, PANE, false)
    await settle()
    calls.length = 0
    await pages.show('a', SITE, PANE, true)
    await settle()
    expect(commands()).not.toContain('web_open')
    expect(last('web_place')).toMatchObject({ tab: 'a', visible: true })
  })
})
describe('a page whose engine cuts only what floats over it', () => {
  const over = {
    cut: { all: false, hollows: [{ x: 500, y: 520, width: 280, height: 60, radius: 8 }] },
    frame: null,
  }
  test('stays shown round a layer over part of it', async () => {
    cuts = 'hollows'
    await built()
    await settle()
    calls.length = 0
    await pages.show('a', SITE, PANE, false, over)
    await settle()
    expect(pages.cuts).toBe(true)
    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: true, cut: over.cut })
    expect(calls.some((one) => one.command === 'web_place' && one.args.visible === false)).toBe(false)
  })
  test('is cut round the layer before its picture is asked for, so the layer waits on the cut alone', async () => {
    cuts = 'hollows'
    await built()
    await settle()
    calls.length = 0
    await pages.show('a', SITE, PANE, false, over)
    await settle()
    expect(commands().filter((one) => one === 'web_place' || one === 'web_shot')).toEqual(['web_place', 'web_shot'])
    expect(last('web_shot')).toEqual({ tab: 'a' })
  })
  test('arrives under such a layer cut round it', async () => {
    cuts = 'hollows'
    await built('a', SITE, PANE, false, over)
    await vi.waitFor(() => expect(last('web_place')).toMatchObject({ visible: true }))
    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, cut: over.cut })
  })
  test('steps out of the way behind its picture under a scrim', async () => {
    cuts = 'hollows'
    await built()
    await settle()
    calls.length = 0
    await pages.show('a', SITE, PANE, false, { cut: { all: true, hollows: [] }, frame: null })
    await settle()
    expect(last('web_place')).toMatchObject({
      tab: 'a',
      visible: true,
      cut: { all: true, hollows: [] },
      pane: { x: -OUT_OF_THE_WAY, y: -OUT_OF_THE_WAY },
    })
    expect(commands()).toContain('web_shot')
  })
  for (const engine of ['hollows', true] as const) {
    test(`takes the picture the page sends each time it draws while a scrim covers it, and stops watching once shown (${String(engine)})`, async () => {
      cuts = engine
      photo = 'data:image/png;base64,AAAA'
      await built()
      await settle()
      calls.length = 0
      await pages.show('a', SITE, PANE, false, { cut: { all: true, hollows: [] }, frame: null })
      await settle()
      expect(calls.filter((one) => one.command === 'web_watch_drawing').map((one) => one.args)).toEqual([
        { tab: 'a', on: true, picture: true },
      ])
      const drew = await hearing('orden://web-drew')
      pages.of('a').shotAt = 0
      drew({ payload: { tab: 'a', picture: 'data:image/jpeg;base64,drawn' } })
      await settle()
      expect(pages.of('a').shot).toBe('data:image/jpeg;base64,drawn')
      await pages.show('a', SITE, PANE, true)
      await vi.waitFor(() => expect(last('web_watch_drawing')).toEqual({ tab: 'a', on: false }))
      pages.of('a').shotAt = 0
      drew({ payload: { tab: 'a', picture: 'data:image/jpeg;base64,late' } })
      await settle()
      expect(pages.of('a').shot).toBe('data:image/jpeg;base64,drawn')
      photo = null
    })
  }
})
test('a covered page that drew is not pictured anew while the app moves', async () => {
  cuts = 'hollows'
  photo = 'data:image/png;base64,AAAA'
  let moving = true
  Object.assign(globalThis, {
    document: {
      getAnimations: () => (moving ? [{ playState: 'running' }] : []),
      querySelector: () => null,
      documentElement: {},
    },
    getComputedStyle: () => ({ getPropertyValue: () => '0px' }),
  })
  try {
    await built()
    await settle()
    await pages.show('a', SITE, PANE, false, { cut: { all: true, hollows: [] }, frame: null })
    await settle()
    const before = pages.of('a').shot
    const drew = await hearing('orden://web-drew')
    pages.of('a').shotAt = 0
    drew({ payload: { tab: 'a', picture: 'data:image/jpeg;base64,moving' } })
    await settle()
    expect(pages.of('a').shot).toBe(before)
    moving = false
    pages.of('a').shotAt = 0
    drew({ payload: { tab: 'a', picture: 'data:image/jpeg;base64,still' } })
    await settle()
    expect(pages.of('a').shot).toBe('data:image/jpeg;base64,still')
    drew({ payload: { tab: 'a', picture: 'data:image/jpeg;base64,soon' } })
    await settle()
    expect(pages.of('a').shot).toBe('data:image/jpeg;base64,still')
    await pages.show('a', SITE, PANE, true)
  } finally {
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'getComputedStyle')
    photo = null
  }
})
test('a page that lands is photographed once, not once per report', async () => {
  await built()
  await settle()
  const moved = await hearing('orden://web-tab')
  calls.length = 0
  const said = { tab: 'a', url: SITE, title: '', back: false, forward: false }
  moved({ payload: { ...said, loading: true } })
  moved({ payload: { ...said, loading: false, title: 'Example Domain' } })
  moved({ payload: { ...said, loading: false } })
  await settle()
  expect(commands().filter((one) => one === 'web_shot')).toHaveLength(1)
})
describe('while the address is being typed', () => {
  async function typing() {
    await built()
    await settle()
    const moved = await hearing('orden://web-tab')
    const went = (url: string) =>
      moved({ payload: { tab: 'a', url, title: '', back: true, forward: false, loading: false } })
    pages.typing('a', true)
    return went
  }
  test('a page that moves on its own is where the tab is once the typing ends', async () => {
    const went = await typing()
    went('https://example.com/b')
    expect(pages.of('a').url).toBe(SITE)
    pages.typing('a', false)
    expect(pages.of('a').url).toBe('https://example.com/b')
  })
  test('an address gone to keeps its place when the typing ends', async () => {
    const went = await typing()
    went('https://example.com/b')
    await pages.go('a', 'https://example.org/')
    pages.typing('a', false)
    expect(pages.of('a').url).toBe('https://example.org/')
  })
})
describe("a page's mark", () => {
  const PLAIN = 'data:image/png;base64,cGxhaW4='
  const BADGED = 'data:image/png;base64,YmFkZ2Vk'
  const NEW = 'data:image/png;base64,bmV3'
  async function loaded() {
    await built()
    await settle()
    const moved = await hearing('orden://web-tab')
    const iconed = await hearing('orden://web-icon')
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
    heard.get('orden://web-icon')?.({ payload: { tab: 'a', icon: 7 } })
    heard.get('orden://web-icon')?.({ payload: null })
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
    await built()
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
describe('a tab that has closed', () => {
  test('is not given a page again by anything that asks after it', async () => {
    await built('closed')
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
    await built('private')
    expect(last('web_open')).toMatchObject({
      tab: 'private',
      profile: { store: null, private: true },
    })
    pages.forget('private')
  })
  test('in the store every page shares, until its web note keeps its own', async () => {
    pages.of('a').space = 'w'
    await built()
    expect(last('web_open')).toMatchObject({ tab: 'a', profile: { store: null, private: false } })
  })
  test('a web note kept apart is built in its own store', async () => {
    pages.of('apart').own = '3f9a0c17e2b4d685'
    await built('apart')
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
    expect(calls.filter((one) => one.command === 'web_close').map((one) => one.args.tab)).toEqual(['a'])
    expect(last('web_open')).toMatchObject({
      tab: 'a',
      profile: { store: 'note_3f9a0c17e2b4d685' },
      pane: { x: -OUT_OF_THE_WAY, y: -OUT_OF_THE_WAY },
    })
    expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: true })
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
    expect(opened.map((one) => (one.args.profile as { store: unknown }).store)).toEqual([null, 'note_3f9a0c17e2b4d685'])
    expect(pages.of('a').live).toBe(true)
  })
  test('a rehouse that leaves a page in the store it was built in loads nothing again', async () => {
    await built()
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
  function away(tab: string, minutes: number): void {
    pages.hide(tab, PANE)
    pages.of(tab).looked = Date.now() - minutes * MINUTES
  }
  function lulls(tab: string): unknown[] {
    return calls.filter((one) => one.command === 'web_pause' && one.args.tab === tab).map((one) => one.args.paused)
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
    const { agentMarks } = await import('../../workspace/src/api')
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
  test('a page left while it is being photographed is hidden at once, the picture finishing on its own', async () => {
    await built('t0')
    let landed = (): void => undefined
    photographing = new Promise<void>((go) => (landed = go))
    pages.of('t0').shot = null
    const shooting = pages.shoot('t0')
    calls.length = 0
    pages.hide('t0', PANE)
    await settle()
    expect(calls.filter((one) => one.command === 'web_place').map((one) => one.args)).toEqual([
      expect.objectContaining({ tab: 't0', pane: PANE, visible: false }),
    ])
    landed()
    await shooting
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
  test('a page switched away from while it wakes stays out of sight', async () => {
    await built('t0')
    away('t0', 30)
    pages.retime()
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true]))
    await settle()
    let answer = (): void => undefined
    pausing = new Promise<void>((go) => (answer = go))
    const showing = pages.show('t0', SITE, PANE)
    await vi.waitFor(() => expect(lulls('t0')).toEqual([true, false]))
    pages.hide('t0', PANE)
    pausing = null
    answer()
    await showing
    await settle()
    expect(last('web_place')).toMatchObject({ tab: 't0', visible: false })
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
      expect(pages.of('t0').sent?.away).toBe(true)
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
    expect(readOpening({ tab: 't', url: 'https://example.com/', behind: 'yes' })?.behind).toBe(false)
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
        getPropertyValue: (token: string) => (of === panes && token === '--card-radius' ? radius : ''),
      }),
    })
  }
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document')
    Reflect.deleteProperty(globalThis, 'getComputedStyle')
  })
  test('is the token where the panes are, and nothing for a square card', () => {
    frame('10px')
    expect(cardCorner()).toEqual([10, 10])
    frame('0px')
    expect(cardCorner()).toEqual([0, 0])
    frame('')
    expect(cardCorner()).toEqual([0, 0])
  })
  test('goes with every placement, nothing where there is no frame to read', async () => {
    await built('round')
    void pages.place('round', MOVED, true)
    await vi.waitFor(() => expect(last('web_place')).toMatchObject({ tab: 'round', pane: MOVED, corner: [0, 0] }))
  })
  test("is its own pane's foot, square where that card's foot is square", () => {
    const card = {}
    const hole = { closest: (selector: string) => (selector === '[data-pane]' ? card : null) }
    const foot = (left: string, right: string) =>
      Object.assign(globalThis, {
        document: { querySelector: () => null },
        getComputedStyle: (of: object) =>
          of === card
            ? { borderBottomLeftRadius: left, borderBottomRightRadius: right }
            : { getPropertyValue: () => '10px' },
      })
    foot('10px', '10px')
    expect(cardCorner(hole as unknown as Element)).toEqual([10, 10])
    foot('0px', '0px')
    expect(cardCorner(hole as unknown as Element)).toEqual([0, 0])
    foot('10px', '0px')
    expect(cardCorner(hole as unknown as Element)).toEqual([10, 0])
    foot('0px', '10px')
    expect(cardCorner(hole as unknown as Element)).toEqual([0, 10])
  })
  test("goes with the placement as its pane says it, over the window's own", async () => {
    frame('10px')
    await built('foot')
    void pages.place('foot', MOVED, true, false, { cut: null, frame: null, corner: [0, 10] })
    await vi.waitFor(() => expect(last('web_place')).toMatchObject({ tab: 'foot', pane: MOVED, corner: [0, 10] }))
    void pages.place('foot', PANE, true)
    await vi.waitFor(() => expect(last('web_place')).toMatchObject({ tab: 'foot', pane: PANE, corner: [10, 10] }))
  })
})
describe('a page a person presses in or types into', () => {
  let did: string[] = []
  let inFront = 'a'
  beforeEach(async () => {
    did = []
    inFront = 'a'
    const { workspace } = await import('../../workspace/src/api')
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
    await built('b')
    const chosen = await hearing('orden://web-chosen')
    chosen({ payload: { tab: 'b' } })
    await vi.waitFor(() => expect(did).toEqual(['activate b']))
    chosen({ payload: { tab: 'b' } })
    await settle()
    expect(did).toEqual(['activate b'])
  })
  test('chooses no tab it does not hold, and reads nothing else as one', async () => {
    const chosen = await hearing('orden://web-chosen')
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
    const { workspace } = await import('../../workspace/src/api')
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
    await built()
    const opening = await hearing('orden://web-open')
    opening({ payload: { tab: 'a', url: FILE } })
    await settle()
    await built('b', FILE)
    await settle()
    const download = await hearing('orden://web-download')
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
  const crash = async (tab: string) => {
    const page = await hearing('orden://web-page')
    page({ payload: { tab, said: 'crashed' } })
    await settle()
  }
  test('goes, keeps its trail, and is not built again on its own', async () => {
    await built('crashing')
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
    await built('reloading')
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
    await built('typed')
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
    await built('left')
    await crash('left')
    calls.length = 0
    await pages.step('left', 'reload')
    expect(calls).toContainEqual({ command: 'web_close', args: { tab: 'left', keep: true } })
    expect(pages.of('left').crashed).toBe(false)
  })
  test('one that did not arrive goes the same way, says why, and comes back with Reload', async () => {
    await built('failing')
    calls.length = 0
    const page = await hearing('orden://web-page')
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
    await built('nameless')
    const page = await hearing('orden://web-page')
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
    await built('drawn')
    const page = await hearing('orden://web-page')
    page({
      payload: { tab: 'drawn', said: 'arrived', url: SITE, failure: 'other', bare: false },
    })
    await settle()
    expect(pages.of('drawn').live).toBe(true)
    expect(pages.of('drawn').failure).toBe(null)
  })
  test('a build that is refused after Reload offers Reload again', async () => {
    await built('refused')
    await crash('refused')
    await pages.step('refused', 'reload')
    refuse = true
    await built('refused')
    refuse = false
    expect(pages.of('refused').crashed).toBe(true)
    expect(pages.of('refused').openable).toBe(true)
  })
  test('a page on its way out says so to nobody', async () => {
    await built('parked')
    await pages.park('parked')
    await crash('parked')
    expect(pages.of('parked').crashed).toBe(false)
  })
})
describe('a page parked out of sight', () => {
  test('keeps its page when its tab is shown again while it is asked where it is', async () => {
    await built('chosen')
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
    await built('left')
    pages.hide('left', PANE)
    await settle()
    calls.length = 0
    await pages.park('left', true)
    expect(pages.of('left').live).toBe(false)
    expect(calls).toContainEqual({ command: 'web_close', args: { tab: 'left', keep: true } })
    pages.forget('left')
  })
  test('says first whether something typed into it would be lost', async () => {
    await built('typed')
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
describe('a page something comes over', () => {
  afterEach(async () => {
    photographing = null
    photo = null
    await pages.letGo()
  })
  function moved(): boolean {
    return calls.some(
      (one) =>
        one.command === 'web_place' &&
        one.args.tab === 'a' &&
        one.args.visible === true &&
        (one.args.pane as { x: number }).x === -OUT_OF_THE_WAY,
    )
  }
  async function covered(): Promise<() => void> {
    await built()
    await pages.show('a', SITE, PANE, true)
    await settle()
    pages.of('a').shot = null
    let landed = (): void => undefined
    photographing = new Promise<void>((go) => (landed = go))
    photo = 'data:image/png;base64,now'
    calls.length = 0
    void pages.show('a', SITE, PANE, false)
    await settle()
    return landed
  }
  test('stays in front until a picture of it as it is now stands in its place', async () => {
    const landed = await covered()
    expect(moved()).toBe(false)
    landed()
    await vi.waitFor(() => expect(moved()).toBe(true))
    expect(pages.of('a').shot).toBe('data:image/png;base64,now')
  })
  test.each([false, 'hollows'] as const)(
    'is moved out of the way, still drawn, rather than hidden, so it comes back with nothing to draw (cuts %s)',
    async (cutting) => {
      cuts = cutting
      const landed = await covered()
      landed()
      await vi.waitFor(() => expect(moved()).toBe(true))
      expect(calls.some((one) => one.command === 'web_place' && one.args.visible === false)).toBe(false)
      expect(last('web_place')).toMatchObject({ cut: { all: true, hollows: [] } })
      await pages.show('a', SITE, PANE, true)
      expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: true })
    },
  )
  test('is not moved once it was shown again while its picture was being taken', async () => {
    const landed = await covered()
    await pages.show('a', SITE, PANE, true)
    landed()
    await settle()
    expect(moved()).toBe(false)
    expect(last('web_place')).toMatchObject({ tab: 'a', visible: true })
  })
  test.each([false, 'hollows'] as const)(
    'is moved out of the way under the overview too, and put back as it closes (cuts %s)',
    async (cutting) => {
      cuts = cutting
      await built()
      await pages.show('a', SITE, PANE, true)
      await settle()
      calls.length = 0
      await pages.holdStill()
      expect(moved()).toBe(true)
      expect(calls.some((one) => one.command === 'web_place' && one.args.visible === false)).toBe(false)
      await pages.letGo()
      expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: true })
    },
  )
})
test('a picture already being taken when the overview opens is not waited for: the page is put out of its place at once', async () => {
  cuts = 'hollows'
  await built()
  await settle()
  let landed = (): void => undefined
  photographing = new Promise<void>((go) => (landed = go))
  pages.of('a').shot = null
  const taking = pages.retake('a', pages.of('a'))
  calls.length = 0
  let held = false
  const holding = pages.holdStill()?.then(() => (held = true))
  await vi.waitFor(() => expect(held).toBe(true))
  expect(last('web_place')).toMatchObject({ tab: 'a', visible: true, pane: { x: -OUT_OF_THE_WAY } })
  landed()
  await Promise.all([taking, holding])
  await pages.letGo()
  await settle()
  photographing = null
})
test('pages held still are out of their place at once, and their pictures come after', async () => {
  cuts = 'hollows'
  await built()
  await settle()
  let landed = (): void => undefined
  photographing = new Promise<void>((go) => (landed = go))
  pages.of('a').shot = null
  calls.length = 0
  await pages.holdStill()
  expect(last('web_place')).toMatchObject({ tab: 'a', visible: true, pane: { x: -OUT_OF_THE_WAY } })
  expect(last('web_shot')).toEqual({ tab: 'a', quick: true })
  expect(pages.of('a').heldAt).not.toBeNull()
  landed()
  await settle()
  await pages.letGo()
  await settle()
  expect(last('web_place')).toMatchObject({ tab: 'a', pane: PANE, visible: true })
  photographing = null
})
test('a page glanced at before the overview opens is pictured quick, as small as the overview draws it', async () => {
  await built()
  await settle()
  const page = pages.of('a')
  page.shot = null
  calls.length = 0
  const { glance } = await import('./still')
  glance(pages, 'a')
  await settle()
  expect(last('web_shot')).toEqual({ tab: 'a', quick: true })
})
