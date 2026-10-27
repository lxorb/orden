/** A web note set back to Global clears the web data it kept, and only where nothing
 *  else still keeps its pages there: a store another note names is that note's sign-in,
 *  and clearing it signed that note out without a word. See own-data.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

const files = new Map<string, string>()
const cleared: unknown[] = []
const asked: string[] = []
let rows: { label: string; run: () => void }[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'read_note') {
      const text = files.get(String(args.path))
      return text === undefined ? Promise.reject(new Error('missing')) : Promise.resolve(text)
    }
    if (command === 'web_clear') cleared.push(args.stores)
    return Promise.resolve(undefined)
  },
}))
vi.mock('../menu.svelte', () => ({
  menu: { replace: (next: typeof rows) => (rows = next) },
}))
vi.mock('../prompt.svelte', () => ({
  prompt: {
    confirm: (said: { title: string }) => {
      asked.push(said.title)
      return Promise.resolve(true)
    },
  },
}))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('../workspace/write-file', () => ({
  writeFile: (path: string, text: string) => {
    files.set(path, text)
    return Promise.resolve()
  },
}))
vi.mock('./keep', () => ({ keepNow: () => undefined }))
vi.mock('./clearing', () => ({ sitesSince: () => [] }))
vi.mock('./pages.svelte', () => ({ pages: { rehouse: () => Promise.resolve() } }))
const copying = new Set<string>()
vi.mock('./web-data.svelte', () => ({
  isCopying: (own: string) => copying.has(own),
  freshOwn: () => 'fedcba9876543210',
  ownStore: (own: string | null) => (own ? `note_${own}` : null),
  webData: { history: () => 'nib:web-visits' },
}))

const tabs: { kind: string; path: string | null; apart: string | null; id: string }[] = []
const listed: { path: string; name: string }[] = []
vi.mock('../workspace.svelte', () => ({
  workspace: {
    documentAt: () => null,
    get tabs() {
      return tabs
    },
    get files() {
      return listed
    },
  },
}))

const { showWebData } = await import('./own-data')

const SEPARATE =
  '[InternetShortcut]\r\nURL=https://mail.example/\r\nTitle=Mail\r\nNib-Data=0123456789abcdef\r\n'

async function setGlobal(path: string) {
  await showWebData(path)
  rows.find((one) => one.label === 'Global')!.run()
  await vi.waitFor(() => expect(files.get(path)).not.toContain('Nib-Data'))
  await new Promise((done) => setTimeout(done, 0))
}

beforeEach(() => {
  files.clear()
  cleared.length = 0
  asked.length = 0
  tabs.length = 0
  listed.length = 0
  copying.clear()
})

test('a note set back to Global clears the store only it named', async () => {
  files.set('/s/A.url', SEPARATE)
  listed.push({ path: '/s/A.url', name: 'A.url' })

  await setGlobal('/s/A.url')

  expect(asked).toHaveLength(1)
  expect(cleared).toEqual([['note_0123456789abcdef']])
})

test('a note set back to Global leaves a store another listed note still names', async () => {
  files.set('/s/A.url', SEPARATE)
  files.set('/s/B.url', SEPARATE.replace('Mail', 'Mail 2'))
  listed.push({ path: '/s/A.url', name: 'A.url' }, { path: '/s/B.url', name: 'B.url' })

  await setGlobal('/s/B.url')

  expect(cleared).toEqual([])
  // Nothing is deleted, so nothing is asked.
  expect(asked).toEqual([])
})

test('a note set back to Global leaves a store a note open in a tab still names', async () => {
  files.set('/s/A.url', SEPARATE)
  files.set('/other/B.url', SEPARATE.replace('Mail', 'Mail 2'))
  tabs.push({ kind: 'web', path: '/other/B.url', apart: null, id: 't' })
  listed.push({ path: '/s/A.url', name: 'A.url' })

  await setGlobal('/s/A.url')

  expect(cleared).toEqual([])
})

test('a note set back to Global leaves a store a tab saved out of it is being copied from', async () => {
  files.set('/s/A.url', SEPARATE)
  listed.push({ path: '/s/A.url', name: 'A.url' })
  // A link-out tab of A is being saved: its store is copied out of A's (`ownFor`).
  copying.add('0123456789abcdef')

  await setGlobal('/s/A.url')

  expect(cleared).toEqual([])
})
