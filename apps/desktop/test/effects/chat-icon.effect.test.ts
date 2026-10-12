/** A chat's icon, drawn where a chat is shown: the Chats panel's row and the chat's head
 *  (ChatMark), and the file list, the tab and the palette (FileMark, handed the
 *  pointer's path). Issue #227: a chat could not wear an icon the way a note does.
 *
 *  In the jsdom project because the icon arrives after the mark is drawn: the pointer is
 *  read on its own the first time a mark asks (marks-elsewhere.svelte.ts), and the mark
 *  redraws because what it derived from has changed. A pointer written again redraws it
 *  the same way.
 *
 *  And the whole road once, the way the owner took it: a chat opens in its tab the moment
 *  it is made, so the chat somebody right-clicks in the file list is open, and its icon
 *  was measured against the tab's empty words and never written. Chosen, coloured, taken
 *  away and read again after a restart, with every mark looked at each time. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const CHAT = 'c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e'

/** The pointers on the disk, by path. */
const files: Record<string, string> = {}

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  invoke: (command: string, args: { path?: string; content?: string } = {}) => {
    const path = String(args.path)
    if (command === 'write_note') files[path] = String(args.content)
    if (command !== 'read_note') return Promise.resolve(undefined)
    const held = files[path]
    return held === undefined ? Promise.reject(new Error('no such file')) : Promise.resolve(held)
  },
}))

const ChatMark = (await import('../../src/lib/chats/view/ChatMark.svelte')).default
const FileMark = (await import('../../src/lib/FileMark.svelte')).default
const { GLYPHS } = await import('../../src/lib/chats/view/glyphs')
const { elsewhere } = await import('../../src/lib/marks-elsewhere.svelte')
const TabMark = (await import('../../src/lib/TabMark.svelte')).default
const { workspace } = await import('../../src/lib/workspace.svelte')
const { openChat } = await import('../../src/lib/chats/view/open')
const { setFileIcon } = await import('../../src/lib/file-icon')
const { iconEntries } = await import('../../src/lib/menu.svelte')
const { iconLibrary } = await import('../../src/lib/icon-library.svelte')
const { loadIcons } = await import('../../src/lib/icons')

// The stroked set in place before anything is drawn, as TabMark.test.ts has it: in the
// app it arrives a moment after the first paint.
iconLibrary.set = await loadIcons()

let target: HTMLElement
const mounted: ReturnType<typeof mount>[] = []

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  elsewhere.clear()
})

afterEach(() => {
  for (const one of mounted.splice(0)) void unmount(one)
  target.remove()
  workspace.tabs = []
})

function drawChat(path: string | null) {
  mounted.push(mount(ChatMark, { target, props: { path } }))
  flushSync()
}

function drawRow(path: string) {
  mounted.push(mount(FileMark, { target, props: { mark: 'chat', path } }))
  flushSync()
}

/** The emoji each mark on screen wears, in order. */
const emoji = () => [...target.querySelectorAll('.emoji')].map((one) => one.textContent)

/** Whether a `#` is drawn, which is what a chat that chose nothing wears in the panel. */
const hashes = () => target.querySelectorAll(`path[d="${GLYPHS.hash}"]`).length

test('a chat that chose an icon wears it in the panel, the head and the file list', async () => {
  files['/space/Team.chat'] = `{"v":1,"chat":"${CHAT}","icon":"🚀"}\n`
  drawChat('/space/Team.chat')
  drawRow('/space/Team.chat')

  // Its kind's mark until the pointer has been read, and then the chosen one.
  expect(hashes()).toBe(1)
  await vi.waitFor(() => {
    flushSync()
    expect(emoji()).toEqual(['🚀', '🚀'])
  })
  expect(hashes()).toBe(0)
})

test('one that chose nothing keeps the mark every chat wears', async () => {
  files['/space/Plain.chat'] = `{"v":1,"chat":"${CHAT}"}\n`
  drawChat('/space/Plain.chat')
  drawChat(null)

  await vi.waitFor(() => expect(elsewhere.of('/space/Plain.chat')).not.toBeNull())
  flushSync()
  expect(emoji()).toEqual([])
  expect(hashes()).toBe(2)
})

test('a pointer written again is what the mark wears next', async () => {
  files['/space/Team.chat'] = `{"v":1,"chat":"${CHAT}","icon":"🚀"}\n`
  drawChat('/space/Team.chat')
  await vi.waitFor(() => {
    flushSync()
    expect(emoji()).toEqual(['🚀'])
  })

  elsewhere.saved('/space/Team.chat', `{"v":1,"chat":"${CHAT}","icon":"🌱"}\n`)
  await vi.waitFor(() => {
    flushSync()
    expect(emoji()).toEqual(['🌱'])
  })

  elsewhere.saved('/space/Team.chat', `{"v":1,"chat":"${CHAT}"}\n`)
  await vi.waitFor(() => {
    flushSync()
    expect(hashes()).toBe(1)
  })
})

/** The strokes a rocket is drawn with, which tell it from a chat's own drawing. */
const ROCKET = new Set(
  (iconLibrary.shape('rocket') ?? []).flatMap(([, attrs]) =>
    typeof attrs.d === 'string' ? [attrs.d] : [],
  ),
)

/** What one mark wears: an emoji by its character, the rocket with its colour or
 *  without, the `#`, or `kind` for the drawing every chat wears in the file list. */
function wornBy(host: Element): string {
  const emoji = host.querySelector('.emoji')
  if (emoji) return emoji.textContent
  if (host.querySelector(`path[d="${GLYPHS.hash}"]`)) return '#'
  const svg = host.querySelector('svg')
  const strokes = [...(svg?.querySelectorAll('path') ?? [])].map((one) => one.getAttribute('d'))
  const rocket = strokes.length > 0 && strokes.every((one) => one !== null && ROCKET.has(one))
  if (!rocket) return 'kind'
  return svg?.style.color ? 'rocket, coloured' : 'rocket'
}

test('an icon chosen for an open chat is written into its pointer and worn everywhere', async () => {
  const path = '/space/Team.chat'
  const bare = `{"v":1,"chat":"${CHAT}"}\n`
  files[path] = bare
  openChat(path)
  const tab = workspace.tabs.find((one) => one.kind === 'channel')
  if (!tab) throw new Error('the chat did not open in a tab')

  /** Every place a chat is shown, each in a box of its own: its row in the file list
   *  (and a bookmark, the palette and the Links panel, which draw the same mark), its
   *  tab, and the Chats panel's row and the chat's head. */
  const draw = () => {
    const box = () => target.appendChild(document.createElement('p'))
    const [row, inTab, chat] = [box(), box(), box()]
    mounted.push(mount(FileMark, { target: row, props: { mark: 'chat', path } }))
    mounted.push(mount(TabMark, { target: inTab, props: { tab } }))
    mounted.push(mount(ChatMark, { target: chat, props: { path } }))
    flushSync()
    return () => [row, inTab, chat].map(wornBy)
  }
  const wearing = (expected: string[], marks: () => string[]) =>
    vi.waitFor(() => {
      flushSync()
      expect(marks()).toEqual(expected)
    })

  let marks = draw()
  await wearing(['kind', 'kind', '#'], marks)
  expect(iconEntries(path).map((one) => one?.label)).toEqual(['Choose an icon'])

  await setFileIcon(path, '🚀')
  expect(files[path]).toBe(`{"v":1,"chat":"${CHAT}","icon":"🚀"}\n`)
  await wearing(['🚀', '🚀', '🚀'], marks)

  // A stroked icon in a colour, which is what the picker writes with a dot chosen.
  await setFileIcon(path, 'rocket', 'orange')
  expect(files[path]).toBe(`{"v":1,"chat":"${CHAT}","icon":"rocket","iconColor":"orange"}\n`)
  await wearing(['rocket, coloured', 'rocket, coloured', 'rocket, coloured'], marks)

  // Remove icon, pressed in the row's own menu.
  const remove = iconEntries(path).find((one) => one?.label === 'Remove icon')
  if (!remove) throw new Error('no Remove icon in the menu')
  remove.run()
  await vi.waitFor(() => expect(files[path]).toBe(bare))
  await wearing(['kind', 'kind', '#'], marks)

  // A restart: nothing read yet, every mark drawn again from the file.
  await setFileIcon(path, 'rocket', 'orange')
  for (const one of mounted.splice(0)) void unmount(one)
  target.replaceChildren()
  elsewhere.clear()
  marks = draw()
  await wearing(['rocket, coloured', 'rocket, coloured', 'rocket, coloured'], marks)
})
