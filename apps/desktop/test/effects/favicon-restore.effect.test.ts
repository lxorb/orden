import { afterEach, expect, test, vi } from 'vitest'

const invoked: string[] = []

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  invoke: (command: string) => {
    invoked.push(command)
    return Promise.resolve(undefined)
  },
}))

vi.mock('../../src/lib/own-window', () => ({
  hearHere: () => Promise.resolve(() => undefined),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))

const SITE = 'https://web.whatsapp.com/'
const MARK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

afterEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
})

test('a tab restored with no page wears the mark its site last showed, in its first frame', async () => {
  const before = await import('../../src/lib/web-tab/favicons')
  before.saw(SITE, MARK)
  before.write()

  vi.resetModules()
  const { flushSync, mount, unmount } = await import('svelte')
  const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
  const { pages } = await import('../../src/lib/web-tab/pages.svelte')
  const TabMark = (await import('../../src/lib/TabMark.svelte')).default

  const doc = new NoteDoc(
    { kind: 'web', path: null, name: 'WhatsApp', text: '', dirty: false },
    () => undefined,
  )
  const tab = new Tab(doc, 'pane')
  tab.address = SITE

  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(TabMark, { target, props: { tab } })
  flushSync()

  const picture = target.querySelector('img')
  expect(picture?.getAttribute('src'), 'the site s mark, in the first frame').toBe(MARK)
  expect(target.querySelectorAll('svg'), 'and no globe beside or before it').toHaveLength(0)
  expect(picture?.getAttribute('draggable')).toBe('false')

  expect(pages.of(tab.id).live).toBe(false)
  expect(invoked).not.toContain('web_open')

  const live = MARK.replace('iVBOR', 'iVBOx')
  pages.of(tab.id).icon = live
  flushSync()
  expect(target.querySelector('img')?.getAttribute('src')).toBe(live)

  void unmount(app, { outro: false })
})
