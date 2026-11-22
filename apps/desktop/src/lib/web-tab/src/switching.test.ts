import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('window', {})
vi.stubGlobal('requestAnimationFrame', (go: () => void) => setTimeout(go, 0))

interface Call {
  command: string
  args: Record<string, unknown>
  at: number
}
interface Frame {
  at: number
  shown: string[]
}
const COSTS: Record<string, number> = { web_place: 30, web_open: 60, web_look: 5, web_shot: 40 }
const calls: Call[] = []
const frames: Frame[] = []
const shown = new Set<string>()
let thawing = 160
let held: Promise<void> | null = null
let queue = Promise.resolve()
const heard = new Map<string, (event: { payload: unknown }) => void>()

function later(ms: number): Promise<void> {
  return new Promise((go) => setTimeout(go, ms))
}
function drawn(tab: string, on: boolean): void {
  if (on) shown.add(tab)
  else shown.delete(tab)
  frames.push({ at: Date.now(), shown: [...shown].sort() })
}
function onScreen(args: Record<string, unknown>): boolean {
  const pane = args.pane as { x: number } | undefined
  return args.visible === true && (pane?.x ?? 0) > -1000
}
async function crate(command: string, args: Record<string, unknown>): Promise<unknown> {
  if (command === 'web_pause') {
    await later(args.paused === true ? 20 : thawing)
    if (args.paused === true) drawn(String(args.tab), false)
    return true
  }
  if (command === 'web_look') throw new Error('that page said nothing')
  const turn = queue.then(async () => {
    if (command === 'web_place' && held) await held
    await later(COSTS[command] ?? 0)
    if (command === 'web_place') drawn(String(args.tab), onScreen(args))
  })
  queue = turn.catch(() => undefined)
  await turn
  if (command === 'web_open') heard.get('orden://web-painted')?.({ payload: { tab: args.tab, url: args.url } })
  return undefined
}
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args: args ?? {}, at: Date.now() })
    return crate(command, args ?? {})
  },
}))
vi.mock('../../windows/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../windows/src/api')>()),
  hearHere: (name: string, tell: (event: { payload: unknown }) => void) => {
    heard.set(name, tell)
    return Promise.resolve(() => undefined)
  },
}))
const { pages } = await import('./pages.svelte')
await Promise.all([
  import('./web-data.svelte').then((one) => one.webData.merged()),
  import('./permissions.svelte'),
  import('./still'),
  import('./sleeping'),
  import('./lending'),
  import('./visited'),
  import('./self-close'),
  import('./keys'),
  import('./downloads.svelte'),
  import('./heard'),
  import('../../gates/src/api'),
  import('../../windows/src/api'),
])

const SITE = 'https://example.com/'
const PANE = { x: 0, y: 0, width: 800, height: 600 }
const MOVED = { x: 260, y: 40, width: 540, height: 600 }
const TABS = ['wa', 'dc', 'pm']

async function run(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}
async function opened(): Promise<void> {
  let front: string | null = null
  for (const tab of TABS) {
    if (front) pages.hide(front, PANE)
    void pages.show(tab, SITE + tab, PANE)
    front = tab
    await vi.waitFor(() => expect(shown).toEqual(new Set([tab])), { timeout: 10_000 })
  }
  vi.useFakeTimers()
}
function switched(from: string, order: string[]): Promise<void> {
  return order.reduce(async (before, tab, at) => {
    await before
    if (at > 0) await run(100)
    pages.hide(at === 0 ? from : (order[at - 1] ?? from), PANE)
    void pages.show(tab, SITE + tab, PANE)
  }, Promise.resolve())
}
function membership(after: Frame[], tab: string): boolean[] {
  return after.map((frame) => frame.shown.includes(tab)).filter((on, at, all) => at === 0 || on !== all[at - 1])
}
async function burst(from: string, frozen: boolean): Promise<void> {
  if (frozen) for (const tab of TABS) if (tab !== from) pages.freeze(tab)
  await run(500)
  const order = Array.from({ length: 10 }, (_, at) => TABS[(TABS.indexOf(from) + 1 + at) % TABS.length] ?? from)
  const last = order.at(-1) ?? from
  const before = order.at(-2) ?? from
  await switched(from, order)
  const stopped = Date.now()
  await run(3000)
  const after = frames.filter((frame) => frame.at >= stopped)
  const strays = after.filter((frame) => frame.shown.some((tab) => tab !== last && tab !== before))
  expect(strays, 'a page switched away from earlier was shown after the last switch').toEqual([])
  expect(membership(after, before).slice(1), 'the page left last came back').not.toContain(true)
  expect(membership(after, last).slice(1), 'the last page went away again').not.toContain(false)
  expect(frames.at(-1)?.shown).toEqual([last])
}

beforeEach(() => {
  calls.length = 0
  frames.length = 0
  shown.clear()
  thawing = 160
  held = null
  queue = Promise.resolve()
})
afterEach(async () => {
  for (const tab of TABS) pages.forget(tab)
  await run(1000)
  vi.useRealTimers()
})

describe('ten switches between web tabs in a second', () => {
  test('end on the last tab, with no earlier one shown again, while the pages run', async () => {
    await opened()
    await burst('pm', false)
  })
  test('end on the last tab, with no earlier one shown again, while each page wakes slower than a switch', async () => {
    await opened()
    await burst('pm', true)
  })
})

describe('a switch that lands late', () => {
  test('does not show a page switched away from while its placement waited behind another', async () => {
    await opened()
    let release = (): void => undefined
    held = new Promise<void>((go) => (release = go))
    void pages.show('pm', SITE + 'pm', MOVED)
    await run(0)
    void pages.show('pm', SITE + 'pm', PANE)
    await run(0)
    pages.hide('pm', PANE)
    void pages.show('wa', SITE + 'wa', PANE)
    const left = calls.length
    held = null
    release()
    await run(1000)
    const shownAgain = calls
      .slice(left)
      .filter((one) => one.command === 'web_place' && one.args.tab === 'pm' && one.args.visible === true)
    expect(shownAgain).toEqual([])
    expect(frames.at(-1)?.shown).toEqual(['wa'])
  })
  test('places a page shown, left and shown again while it wakes once, where it was asked last', async () => {
    await opened()
    pages.hide('pm', PANE)
    void pages.show('wa', SITE + 'wa', PANE)
    await run(500)
    pages.freeze('pm')
    await run(500)
    const left = calls.length
    void pages.show('pm', SITE + 'pm', MOVED)
    await run(20)
    pages.hide('pm', MOVED)
    void pages.show('pm', SITE + 'pm', PANE)
    await run(1000)
    const placed = calls
      .slice(left)
      .filter((one) => one.command === 'web_place' && one.args.tab === 'pm' && one.args.visible === true)
      .map((one) => one.args.pane)
    expect(placed).toEqual([PANE])
  })
})
