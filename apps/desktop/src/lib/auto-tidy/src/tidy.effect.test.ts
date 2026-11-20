import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { providePort, webPages } from '@orden/contracts'
import { memoryStorage } from '../../../../test/disk'

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: (command: string) => Promise.resolve(command === 'read_note' ? '' : undefined),
}))
vi.stubGlobal('localStorage', memoryStorage())
const { workspace, agentMarks } = await import('../../workspace/src/api')
const { NoteDoc, Tab } = await import('../../documents/src/api')
const { autoTidy, seen, startAutoTidy, sweep, tidyable } = await import('./api')
type Tab = import('../../workspace/src/api').Tab
type TabKind = import('@orden/contracts').TabKind
const HOUR = 3_600_000
const T0 = Date.UTC(2026, 10, 19, 9)
const playing = new Set<string>()
const lent = new Set<string>()
const quiet = webPages()
providePort('web.pages', {
  ...quiet,
  of: (id) => ({ ...quiet.of(id), playing: playing.has(id) }),
  lentOf: (id) => lent.has(id),
})
function add(name: string, kind: TabKind = 'note', path: string | null = `/space/${name}.md`, paneId?: string): Tab {
  const doc = new NoteDoc({ kind, path, name, text: '', dirty: false }, () => undefined)
  const tab = new Tab(doc, paneId ?? workspace.panes.focusedId)
  workspace.tabs = [...workspace.tabs, tab]
  return tab
}
const names = () => workspace.tabs.map((one) => one.name)
let stop: (() => void) | null = null
beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.restored = true
  agentMarks.on = {}
  playing.clear()
  lent.clear()
  autoTidy.set(false)
  autoTidy.setHours(24)
  autoTidy.set(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  stop?.()
  stop = null
  vi.useRealTimers()
})
function aside(): [Tab, Tab] {
  const front = add('Front')
  const back = add('Back')
  workspace.activate(front.id)
  sweep(Date.now())
  return [front, back]
}
describe('the setting', () => {
  test('is off out of the box with 24 hours, and off it closes nothing', () => {
    localStorage.removeItem('orden:auto-tidy')
    localStorage.removeItem('orden:auto-tidy-hours')
    autoTidy.set(false)
    expect(autoTidy.hours).toBe(24)
    aside()
    vi.setSystemTime(T0 + 30 * 24 * HOUR)
    expect(sweep(Date.now())).toEqual([])
    expect(names()).toEqual(['Front', 'Back'])
  })
  test('turned on, counts from then, so old tabs do not close at once', () => {
    autoTidy.set(false)
    add('Old')
    workspace.activate(add('Front').id)
    seen.stamp(['/space/Old.md'], T0 - 100 * HOUR)
    autoTidy.set(true)
    expect(sweep(Date.now())).toEqual([])
    vi.setSystemTime(T0 + 24 * HOUR)
    expect(sweep(Date.now()).map((one) => one.name)).toEqual(['Old'])
  })
})
describe('a tab out of sight', () => {
  test('closes after 24 hours, and not a minute before', () => {
    aside()
    vi.setSystemTime(T0 + 24 * HOUR - 60_000)
    expect(sweep(Date.now())).toEqual([])
    vi.setSystemTime(T0 + 24 * HOUR)
    expect(sweep(Date.now()).map((one) => one.name)).toEqual(['Back'])
    expect(names()).toEqual(['Front'])
  })
  test('counts again from the last time it was shown', () => {
    stop = startAutoTidy()
    const [front, back] = aside()
    vi.setSystemTime(T0 + 20 * HOUR)
    workspace.activate(back.id)
    flushSync()
    workspace.activate(front.id)
    flushSync()
    vi.setSystemTime(T0 + 30 * HOUR)
    expect(sweep(Date.now())).toEqual([])
    vi.setSystemTime(T0 + 44 * HOUR)
    expect(sweep(Date.now()).map((one) => one.name)).toEqual(['Back'])
  })
  test('the tab left behind counts from when it went out of sight', () => {
    stop = startAutoTidy()
    const [front, back] = aside()
    flushSync()
    vi.setSystemTime(T0 + 10 * HOUR)
    workspace.activate(back.id)
    flushSync()
    vi.setSystemTime(T0 + 30 * HOUR)
    expect(sweep(Date.now())).toEqual([])
    vi.setSystemTime(T0 + 34 * HOUR)
    expect(sweep(Date.now())).toEqual([front])
  })
  test('closes after one hour when the setting says so', () => {
    autoTidy.setHours(1)
    aside()
    vi.setSystemTime(T0 + HOUR - 1)
    expect(sweep(Date.now())).toEqual([])
    vi.setSystemTime(T0 + HOUR)
    expect(sweep(Date.now()).map((one) => one.name)).toEqual(['Back'])
  })
})
describe('the wall clock', () => {
  test('counts the time the app was closed: what was seen is read back on the next start', () => {
    stop = startAutoTidy()
    aside()
    flushSync()
    stop()
    stop = null
    expect(JSON.parse(localStorage.getItem('orden:auto-tidy-seen') ?? '{}')).toMatchObject({
      '/space/Back.md': T0,
    })
    seen.clear()
    localStorage.setItem('orden:auto-tidy-seen', JSON.stringify({ '/space/Back.md': T0, '/space/Front.md': T0 }))
    vi.setSystemTime(T0 + 25 * HOUR)
    stop = startAutoTidy()
    flushSync()
    window.dispatchEvent(new Event('focus'))
    expect(names()).toEqual(['Front'])
  })
  test('counts the time asleep: on waking the next round closes what went stale', () => {
    stop = startAutoTidy()
    aside()
    flushSync()
    vi.setSystemTime(T0 + 25 * HOUR)
    expect(names()).toEqual(['Front', 'Back'])
    vi.advanceTimersByTime(60_000)
    expect(names()).toEqual(['Front'])
  })
  test('a window shown again sweeps at once', () => {
    stop = startAutoTidy()
    aside()
    flushSync()
    vi.setSystemTime(T0 + 25 * HOUR)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(names()).toEqual(['Front'])
  })
})
describe('what never closes', () => {
  test('a draft, an unsaved web tab, a tab with unsaved changes, a running terminal or a chat', () => {
    const kept = [
      add('Draft', 'note', null),
      add('Page', 'web', null),
      add('Shell', 'terminal', '/space/shell.term'),
      add('Chat', 'chat', '/space/c.chat'),
    ]
    const dirty = add('Dirty')
    dirty.dirty = true
    const running = add('Running', 'terminal', '/space/run.term')
    running.running = { name: 'top', program: 'top', host: null, colour: null }
    workspace.activate(add('Front').id)
    sweep(Date.now())
    vi.setSystemTime(T0 + 48 * HOUR)
    expect(sweep(Date.now())).toEqual([])
    for (const one of [...kept, dirty, running]) expect(tidyable(one), one.name).toBe(false)
  })
  test('a tab shown in either pane of a split', () => {
    const left = add('Left')
    workspace.activate(left.id)
    const pane = workspace.panes.split('row')
    if (!pane) throw new Error('no split')
    const right = add('Right', 'note', '/space/Right.md', pane.id)
    const hidden = add('Hidden', 'note', '/space/Hidden.md', pane.id)
    workspace.activate(right.id)
    sweep(Date.now())
    vi.setSystemTime(T0 + 48 * HOUR)
    expect(sweep(Date.now())).toEqual([hidden])
    expect(names()).toEqual(['Left', 'Right'])
  })
  test('a note drawn as a column of a stacked pane', () => {
    const [front, back] = aside()
    workspace.panes.setStacked(front.paneId, true)
    vi.setSystemTime(T0 + 48 * HOUR)
    expect(sweep(Date.now())).toEqual([])
    expect(tidyable(back)).toBe(false)
    workspace.panes.setStacked(front.paneId, false)
  })
  test('a page playing sound, a private page, a lent page, and a tab an agent works in', () => {
    const sound = add('Sound', 'web', '/space/Sound.url')
    const secret = add('Secret', 'web', '/space/Secret.url')
    secret.inPrivate = true
    const borrowed = add('Lent', 'web', '/space/Lent.url')
    const agent = add('Agent')
    playing.add(sound.id)
    lent.add(borrowed.id)
    agentMarks.on = { [agent.id]: { agent: 'a', colour: '#f00', stopped: false } }
    workspace.activate(add('Front').id)
    sweep(Date.now())
    vi.setSystemTime(T0 + 48 * HOUR)
    expect(sweep(Date.now())).toEqual([])
  })
  test('an essential, while a web page saved in the sidebar does close', () => {
    const essential = add('Pinned', 'web', '/space/Pinned.url')
    essential.essential = 'e1'
    const saved = add('Saved', 'web', '/space/Saved.url')
    workspace.activate(add('Front').id)
    sweep(Date.now())
    vi.setSystemTime(T0 + 48 * HOUR)
    expect(sweep(Date.now())).toEqual([saved])
    expect(workspace.tabs).toContain(essential)
  })
})
describe('a tab tidied away', () => {
  test('goes to the closed tabs, and Reopen closed tab brings back the most lately seen first', async () => {
    const a = add('A')
    const b = add('B')
    workspace.activate(add('Front').id)
    seen.stamp(['/space/A.md'], T0 - 2 * HOUR)
    seen.stamp(['/space/B.md'], T0 - HOUR)
    vi.setSystemTime(T0 + 24 * HOUR)
    const before = workspace.closed.stack.length
    expect(sweep(Date.now())).toEqual([a, b])
    expect(workspace.closed.stack.length).toBe(before + 2)
    await workspace.reopenClosed()
    expect(names()).toContain('B')
    expect(names()).not.toContain('A')
    await workspace.reopenClosed()
    expect(names()).toEqual(expect.arrayContaining(['A', 'B', 'Front']))
  })
  test('one sweep never empties a pane that shows nothing', () => {
    add('A')
    add('B')
    workspace.deselect(workspace.panes.focusedId)
    workspace.panes.activate(workspace.panes.focusedId, null)
    sweep(Date.now())
    seen.stamp(['/space/A.md'], T0 - HOUR)
    vi.setSystemTime(T0 + 48 * HOUR)
    expect(sweep(Date.now()).map((one) => one.name)).toEqual(['A'])
    expect(names()).toEqual(['B'])
  })
})
