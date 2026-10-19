import { beforeEach, expect, test, vi } from 'vitest'

/** A web note in the phone app is the reader's browser's: its address handed to the
 *  system, never a page inside nib - not from its row, and not from a tab an older
 *  sitting left of it, which was what Emil still found on the phone (#206). See
 *  `openWeb` in workspace.svelte.ts, and tauri.test.ts for where the address goes. */

const SITE = '/space/Site.url'

const handed: string[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: false,
  isNative: true,
  isMobile: true,
  openExternal: (url: string) => {
    handed.push(url)
    return Promise.resolve()
  },
  invoke: (command: string, args?: Record<string, unknown>) =>
    Promise.resolve(
      command === 'read_note' && args?.path === SITE
        ? '[InternetShortcut]\r\nURL=https://example.com/site\r\n'
        : undefined,
    ),
}))

const { workspace } = await import('./workspace.svelte')
const { Tab } = await import('./workspace/documents.svelte')

beforeEach(() => {
  handed.length = 0
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
})

test('a web note on the phone opens in the browser, not in nib', async () => {
  await workspace.openWeb(SITE)

  expect(handed).toEqual(['https://example.com/site'])
  expect(workspace.tabs).toEqual([])
})

test('and a tab an older sitting left of it goes, its page in the browser instead', async () => {
  const note = workspace.opened.make({
    kind: 'web',
    path: SITE,
    name: 'Site.url',
    text: '',
    dirty: false,
  })
  workspace.tabs = [new Tab(note, workspace.panes.focusedId)]

  await workspace.openWeb(SITE)

  expect(handed).toEqual(['https://example.com/site'])
  expect(workspace.tabs).toEqual([])
})
