import { afterEach, expect, test, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'

const file = { text: '' }

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  invoke: (command: string) => Promise.resolve(command === 'read_note' ? file.text : undefined),
}))

const heard = new Map<string, (event: { payload: unknown }) => void>()
vi.mock('../../src/lib/own-window', () => ({
  hearHere: (name: string, handler: (event: { payload: unknown }) => void) => {
    heard.set(name, handler)
    return Promise.resolve(() => undefined)
  },
}))

const { workspace } = await import('../../src/lib/workspace.svelte')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
const { writeShortcut } = await import('@orden/scan/shortcut')
const FileMark = (await import('../../src/lib/FileMark.svelte')).default

const picture = (one: string) =>
  `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QD${one}ADhgGAWjR9awAAAABJRU5ErkJggg==`
const WRITTEN = picture('w')
const ARRIVED = picture('a')
const UNREAD = picture('u')
const READ = picture('r')

const ROOT = '/Away'
const PATH = `${ROOT}/Slack.url`
const CHANNEL = 'https://app.slack.com/client/T1/C1'
const OTHER_CHANNEL = 'https://app.slack.com/client/T1/C2'
const CHATS = `${ROOT}/WhatsApp.url`
const WHATSAPP = 'https://web.whatsapp.com/'

afterEach(() => {
  workspace.tabs = []
  document.body.innerHTML = ''
  localStorage.clear()
})

const drawn = (target: HTMLElement) => target.querySelector('img')?.getAttribute('src') ?? null

async function marks(tab: string, icon: string) {
  heard.get('nib://web-icon')?.({ payload: { tab, icon } })
  await vi.dynamicImportSettled()
  flushSync()
}

test('the row of an open web note follows its tab’s mark, and keeps the last once it closes', async () => {
  workspace.spaces = [{ id: 'away', name: 'Away', root: ROOT }]
  file.text = writeShortcut(CHANNEL, 'Slack', new Date(0), CHANNEL, WRITTEN)

  const target = document.createElement('div')
  document.body.append(target)
  const row = mount(FileMark, { target, props: { mark: 'web', path: PATH } })
  await vi.waitFor(() => {
    flushSync()
    expect(drawn(target), 'with no tab, what the file wrote').toBe(WRITTEN)
  })

  const tab = new Tab(
    new NoteDoc(
      { kind: 'web', path: PATH, name: 'Slack', text: '', dirty: false },
      () => undefined,
    ),
    'pane',
  )
  workspace.tabs = [tab]
  const page = pages.of(tab.id)
  page.path = PATH
  page.url = CHANNEL
  page.at = CHANNEL
  await vi.waitFor(() => expect(heard.has('nib://web-icon')).toBe(true))
  await marks(tab.id, ARRIVED)
  expect(drawn(target)).toBe(ARRIVED)

  page.url = OTHER_CHANNEL
  page.at = OTHER_CHANNEL
  await marks(tab.id, UNREAD)
  expect(drawn(target), 'the badge, as the tab wears it').toBe(UNREAD)

  await marks(tab.id, READ)
  expect(drawn(target), 'and the badge gone again').toBe(READ)

  workspace.tabs = []
  flushSync()
  expect(drawn(target), 'the tab closed: the last mark it showed').toBe(READ)

  void unmount(row, { outro: false })
})

test('a mark too large for the cache is still the row’s while its tab is open', async () => {
  workspace.spaces = [{ id: 'away', name: 'Away', root: ROOT }]
  file.text = writeShortcut(WHATSAPP, 'WhatsApp', new Date(0), CHANNEL, WRITTEN)

  const target = document.createElement('div')
  document.body.append(target)
  const row = mount(FileMark, { target, props: { mark: 'web', path: CHATS } })
  await vi.waitFor(() => {
    flushSync()
    expect(drawn(target)).toBe(WRITTEN)
  })

  const tab = new Tab(
    new NoteDoc(
      { kind: 'web', path: CHATS, name: 'WhatsApp', text: '', dirty: false },
      () => undefined,
    ),
    'pane',
  )
  workspace.tabs = [tab]
  const page = pages.of(tab.id)
  page.path = CHATS
  page.url = WHATSAPP
  page.at = WHATSAPP
  await vi.waitFor(() => expect(heard.has('nib://web-icon')).toBe(true))

  const large = `data:image/png;base64,${'A'.repeat(30 * 1024)}`
  await marks(tab.id, large)
  expect(drawn(target), 'the tab’s own mark').toBe(large)

  void unmount(row, { outro: false })
})
