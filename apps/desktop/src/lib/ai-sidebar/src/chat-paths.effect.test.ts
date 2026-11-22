import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const ROOT = '/Users/me/Work'
const world = vi.hoisted(() => ({
  revealed: [] as string[],
  closed: 0,
}))
vi.mock('@tauri-apps/api/path', () => ({ homeDir: () => Promise.resolve('/Users/me') }))
vi.mock('../../platform/src/api', async (actual) => ({
  ...(await actual<typeof import('../../platform/src/api')>()),
  isDesktop: true,
  platform: () => 'macos',
}))
vi.mock('../../files-out/src/api', async (actual) => ({
  ...(await actual<typeof import('../../files-out/src/api')>()),
  reveal: (path: string) => Promise.resolve(void world.revealed.push(path)),
  showLabel: () => 'Show in Finder',
}))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({
  chat: { unfolded: false, root: '/Users/me/Work', head: null, provider: null, models: {}, resets: {} },
}))
const SAID = 'Open `Plans/Roadmap.md`, then see /Users/me/Downloads/report.zip and Herons.'
vi.mock('../../ai-chat/src/quick.svelte', () => ({
  side: { open: false, of: null },
  quick: {
    open: true,
    ready: true,
    question: '',
    turns: [
      { role: 'you', text: 'Where is it?' },
      { role: 'model', text: 'Open `Plans/Roadmap.md`, then see /Users/me/Downloads/report.zip and Herons.' },
    ],
    running: false,
    trouble: null,
    context: null,
    texts: [],
    close: () => world.closed++,
    ask: () => undefined,
    stop: () => undefined,
    drop: () => undefined,
  },
}))
const { workspace } = await import('../../workspace/src/api')
const { links } = await import('../../link-index/src/api')
const { menu } = await import('../../ui-kit/src/api')
const Reply = (await import('./Reply.svelte')).default
const QuickQuestion = (await import('./QuickQuestion.svelte')).default
const opened: string[] = []
const menus: string[][] = []
vi.spyOn(links, 'holdsFile').mockImplementation((path) => path === `${ROOT}/Plans/Roadmap.md`)
vi.spyOn(workspace, 'openEntry').mockImplementation((path) => Promise.resolve(void opened.push(path)))
vi.spyOn(menu, 'show').mockImplementation((event, rows) => {
  event.preventDefault()
  menus.push(rows.flatMap((row) => (row ? [row.label] : [])))
  return menus.length
})
workspace.spaces = [{ root: ROOT, name: 'Work' } as never]
Object.defineProperty(workspace, 'activeSpace', { configurable: true, get: () => ({ root: ROOT }) })
const settled = () => new Promise((done) => setTimeout(done, 0))
function press(node: Element | null | undefined, type: 'click' | 'contextmenu', button = type === 'click' ? 0 : 2) {
  if (!node) throw new Error(`nothing to ${type}`)
  return node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button }))
}
function shown(target: HTMLElement): { paths: (string | undefined)[]; spans: HTMLElement[] } {
  const spans = [...target.querySelectorAll<HTMLElement>('.words .chat-path')]
  return { paths: spans.map((one) => one.dataset.path), spans }
}
beforeEach(() => {
  opened.length = 0
  menus.length = 0
  world.revealed.length = 0
  world.closed = 0
})
describe('a path in an AI answer (#2217)', () => {
  test('in the side chat is marked, opens as a tab or in the file manager, and has a menu', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const turn = { id: 't1', role: 'model', parts: [{ kind: 'text', text: SAID }] }
    const drawn = mount(Reply, { target, props: { turn: turn as never, sources: [], last: true, live: false } })
    flushSync()
    const { paths, spans } = shown(target)
    expect(paths).toEqual(['Plans/Roadmap.md', '/Users/me/Downloads/report.zip'])
    const [note, elsewhere] = spans
    expect(press(note, 'click')).toBe(false)
    await settled()
    expect(opened).toEqual([`${ROOT}/Plans/Roadmap.md`])
    press(elsewhere, 'click')
    await settled()
    expect(world.revealed).toEqual(['/Users/me/Downloads/report.zip'])
    expect(opened).toHaveLength(1)
    expect(press(note, 'contextmenu')).toBe(false)
    expect(press(elsewhere, 'contextmenu')).toBe(false)
    expect(menus).toEqual([['Open in a new tab', 'Show in Finder'], ['Show in Finder']])
    expect(press(target.querySelector('.words p'), 'contextmenu')).toBe(true)
    expect(menus).toHaveLength(2)
    void unmount(drawn)
    target.remove()
  })
  test('in a quick question is marked and opens from the active space, closing the sheet', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const drawn = mount(QuickQuestion, { target, props: {} })
    flushSync()
    const { paths, spans } = shown(target)
    expect(paths).toEqual(['Plans/Roadmap.md', '/Users/me/Downloads/report.zip'])
    press(spans[0], 'click')
    await settled()
    expect(opened).toEqual([`${ROOT}/Plans/Roadmap.md`])
    expect(world.closed).toBe(1)
    expect(press(spans[1], 'contextmenu')).toBe(false)
    expect(menus).toEqual([['Show in Finder']])
    void unmount(drawn)
    target.remove()
  })
})
