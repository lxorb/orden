import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'scratchpad_path') return Promise.resolve(PAD)
    if (command === 'list_spaces') return Promise.resolve([])
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const PAD = '/app/Scratchpad.md'

Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
Element.prototype.scrollIntoView = () => undefined
globalThis.ResizeObserver = class {
  observe() {
    // Nothing to measure.
  }

  unobserve() {
    // Nothing to measure.
  }

  disconnect() {
    // Nothing to measure.
  }
}

const { Disk } = await import('../disk')
const { default: Titlebar } = await import('../../src/lib/Titlebar.svelte')
const { default: Sidebar } = await import('../../src/lib/Sidebar.svelte')
const { default: ScratchpadCard } = await import('../../src/lib/scratchpad/ScratchpadCard.svelte')
const { shown, toggleScratchpad } = await import('../../src/lib/scratchpad/is.svelte')
const { scratchpad } = await import('../../src/lib/scratchpad/pad')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { menu } = await import('../../src/lib/menu.svelte')
const { tabMenu } = await import('../../src/lib/tab-strip/menu')
type MenuEntry = import('../../src/lib/menu-item').MenuEntry

let target: HTMLElement
let undo: (() => void)[] = []

beforeEach(() => {
  disk.current = new Disk()
  disk.current.files.set(PAD, 'First thought\n')
  workspace.spaces = [{ id: 'work', name: 'Work', root: '/spaces/Work' }]
  workspace.activeSpaceId = 'work'
  shown.on = false
  shown.calling = false
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  for (const one of undo) one()
  undo = []
  target.remove()
})

function bar() {
  const made = mount(Titlebar, {
    target,
    props: { onpalette: () => undefined, onhistory: () => undefined },
  })
  flushSync()
  undo.push(() => void unmount(made, { outro: false }))
}

async function card() {
  const column = document.createElement('div')
  column.dataset.scratchpad = ''
  target.append(column)
  const made = mount(ScratchpadCard, { target: column })
  undo.push(() => void unmount(made, { outro: false }))
  await vi.waitFor(() => expect(scratchpad.live).not.toBe(null))
  flushSync()
  return column
}

const rightButton = () =>
  [...target.querySelectorAll<HTMLButtonElement>('button[aria-label$="right sidebar"]')].find(
    (one) => one.closest('[inert]') === null,
  )

function barAndSide() {
  bar()
  const made = mount(Sidebar, { target, props: { side: 'right' } })
  flushSync()
  undo.push(() => void unmount(made, { outro: false }))
}

test('the bar has one button for the right side and no switch of the scratchpad’s', () => {
  bar()
  expect(target.querySelector('header button.pad')).toBeNull()
  expect(target.querySelectorAll('header button[aria-label$="right sidebar"]')).toHaveLength(1)
})

test('open or shut, the bar has the button and the side none', () => {
  barAndSide()
  workspace.showRight('outline')
  flushSync()
  const shown = () => target.querySelector('header button[aria-label$="right sidebar"]')
  expect(shown()?.classList.contains('orden-said')).toBe(false)
  expect(target.querySelectorAll('aside button[aria-label$="right sidebar"]')).toHaveLength(0)

  workspace.closeRight()
  flushSync()
  expect(shown()?.classList.contains('orden-said')).toBe(false)
})

test('a phone’s bar has no switch of the scratchpad’s', async () => {
  const { viewport } = await import('../../src/lib/viewport.svelte')
  viewport.device = 'phone'
  undo.push(() => (viewport.device = 'desktop'))
  bar()
  expect(target.querySelector('header [aria-label="Scratchpad"]')).toBeNull()
})

test('pressed with the card up it shuts the side whole, and again it brings the card back', () => {
  barAndSide()
  const tabs = workspace.tabs.length
  workspace.showRight('outline')
  workspace.showRight('scratchpad', false)
  flushSync()
  expect(rightButton()?.getAttribute('aria-pressed')).toBe('true')

  rightButton()?.click()
  flushSync()
  expect(shown.on).toBe(false)
  expect(workspace.rightShows).toBeNull()
  expect(rightButton()?.getAttribute('aria-pressed')).toBe('false')

  rightButton()?.click()
  flushSync()
  expect(shown.on).toBe(true)
  expect(workspace.rightShows).toBe('scratchpad')
  expect(workspace.tabs.length).toBe(tabs)

  rightButton()?.click()
  flushSync()
  expect(workspace.rightShows).toBeNull()
})

test('opening its file from anywhere shows the card instead of a tab', async () => {
  const tabs = workspace.tabs.length
  await workspace.open(PAD)
  expect(shown.on).toBe(true)
  expect(shown.calling).toBe(true)
  expect(workspace.tabs.length).toBe(tabs)
  expect(workspace.tabs.some((one) => one.path === PAD)).toBe(false)
})

test('Ctrl+Shift+X: up, then the keyboard into it from elsewhere, then away from inside', async () => {
  const outside = document.createElement('input')
  target.append(outside)
  outside.focus()

  toggleScratchpad()
  expect(shown.on).toBe(true)
  const column = await card()
  expect(column.contains(document.activeElement)).toBe(true)

  outside.focus()
  toggleScratchpad()
  flushSync()
  expect(shown.on).toBe(true)
  expect(column.contains(document.activeElement)).toBe(true)

  toggleScratchpad()
  expect(shown.on).toBe(false)
  expect(document.activeElement).toBe(outside)
})

test('the card takes the keyboard when asked, and Escape gives it back', async () => {
  const outside = document.createElement('input')
  target.append(outside)
  outside.focus()

  shown.show()
  const column = await card()
  const editor = column.querySelector<HTMLElement>('.cm-content')
  expect(document.activeElement).toBe(editor)
  expect(scratchpad.live?.state.doc.toString()).toBe('First thought\n')

  editor?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  expect(shown.on).toBe(false)
  expect(document.activeElement).toBe(outside)
})

test('a card put back by the launch does not take the keyboard', async () => {
  const outside = document.createElement('input')
  target.append(outside)
  outside.focus()

  shown.show(false)
  await card()
  expect(document.activeElement).toBe(outside)
})

test('what is typed is written as the card goes, and an append lands in the card', async () => {
  shown.show()
  await card()
  const view = scratchpad.live
  view?.dispatch({ changes: { from: view.state.doc.length, insert: 'Second' } })

  await scratchpad.append('From the quick question')
  expect(view?.state.doc.toString()).toBe('First thought\nSecond\n\nFrom the quick question\n')
  expect(disk.current?.files.get(PAD)).toBe('First thought\nSecond\n\nFrom the quick question\n')

  view?.dispatch({ changes: { from: 0, insert: '# ' } })
  for (const one of undo) one()
  undo = []
  await vi.waitFor(() =>
    expect(disk.current?.files.get(PAD)).toBe(
      '# First thought\nSecond\n\nFrom the quick question\n',
    ),
  )
  expect(scratchpad.live).toBe(null)
})

test("an agent's edit lands in the card around the caret, and a stale one is refused", async () => {
  shown.show()
  await card()
  const view = scratchpad.live
  view?.dispatch({ selection: { anchor: 5 } })

  expect(await scratchpad.replace('First thought\n', [{ from: 0, to: 0, insert: '> ' }])).toBe(true)
  expect(view?.state.doc.toString()).toBe('> First thought\n')
  expect(view?.state.selection.main.head).toBe(7)
  expect(disk.current?.files.get(PAD)).toBe('> First thought\n')

  expect(await scratchpad.replace('First thought\n', [{ from: 0, to: 5, insert: '' }])).toBe(false)
  expect(view?.state.doc.toString()).toBe('> First thought\n')
})

test("with the card away, an agent's edit is written to the file", async () => {
  expect(
    await scratchpad.replace('First thought\n', [{ from: 14, to: 14, insert: 'More\n' }]),
  ).toBe(true)
  expect(disk.current?.files.get(PAD)).toBe('First thought\nMore\n')
})

const A_FILES_ROWS = ['Move to space', 'Rename', 'Show in the file list', 'Duplicate']

const labels = (entries: readonly MenuEntry[]) => entries.flatMap((one) => (one ? [one.label] : []))

const TWO_SPACES = [
  { id: 'work', name: 'Work', root: '/spaces/Work' },
  { id: 'home', name: 'Home', root: '/spaces/Home' },
]

test('a right click on the scratchpad’s tab offers nothing, Move to space least of all', async () => {
  workspace.spaces = TWO_SPACES
  const made = mount(Sidebar, { target, props: { side: 'right' } })
  flushSync()
  undo.push(() => void unmount(made, { outro: false }))
  const tab = target.querySelector<HTMLButtonElement>('[role=tab][aria-label="Scratchpad"]')
  expect(tab).not.toBeNull()

  const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  tab?.dispatchEvent(click)
  await vi.dynamicImportSettled()
  flushSync()
  expect(menu.open).toBe(false)
  for (const row of A_FILES_ROWS) expect(labels(menu.items)).not.toContain(row)
})

test("a note in a space keeps the rows the scratchpad's switch leaves out", async () => {
  workspace.spaces = TWO_SPACES
  disk.current?.files.set('/spaces/Work/Plan.md', '# Plan\n')
  await workspace.loadTree()
  await workspace.openEntry('/spaces/Work/Plan.md')
  const plan = workspace.tabs.find((one) => one.path === '/spaces/Work/Plan.md')
  if (!plan) throw new Error('no tab for the note')
  undo.push(() => workspace.close(plan.id, false))

  const rows = labels(tabMenu(plan, plan.paneId))
  for (const row of A_FILES_ROWS.filter((one) => one !== 'Move to space')) {
    expect(rows).toContain(row)
  }
  expect(rows).not.toContain('Move to space')
})

test('a scratchpad that will not read is never opened empty', async () => {
  disk.current?.files.set(PAD, 'a year of notes\n')
  disk.current?.unreadable.add(PAD)
  const { unread } = await import('../../src/lib/unread.svelte')

  shown.show()
  const column = document.createElement('div')
  column.dataset.scratchpad = ''
  target.append(column)
  const made = mount(ScratchpadCard, { target: column })
  undo.push(() => void unmount(made, { outro: false }))

  await vi.waitFor(() => expect(unread.shown).toBe(true))
  flushSync()
  expect(shown.on).toBe(false)
  expect(scratchpad.live).toBe(null)
  expect(column.querySelector('.cm-content')).toBe(null)
  expect(disk.current?.files.get(PAD)).toBe('a year of notes\n')
  unread.dismiss()
})
