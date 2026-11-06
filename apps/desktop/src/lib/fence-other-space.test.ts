import { beforeEach, expect, test, vi } from 'vitest'

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))

const searched: string[] = []
vi.mock('./search/space', () => ({
  searchSpace: (
    root: string,
    _query: unknown,
    _terms: unknown,
    _most: number,
    onFound: (found: { hits: unknown[]; loose: unknown[] }) => void,
  ) => {
    searched.push(root)
    const hit = { path: `${root}/Plan.md`, name: 'Plan', line: 0, text: 'plan', ranges: [] }
    onFound({ hits: [hit], loose: [] })
    return Promise.resolve()
  },
}))

const rowsOf: (string | undefined)[] = []
vi.mock('./rows/rows.svelte', () => ({
  rows: {
    get shown() {
      return this.of
    },
    ready: true,
    of: (space?: string) => {
      rowsOf.push(space)
      return []
    },
    watch: () => () => undefined,
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')
const { readingHtml } = await import('./reading/render')

beforeEach(() => {
  searched.length = 0
  rowsOf.length = 0
  workspace.spaces = [
    { id: 'a', name: 'A', root: '/A' },
    { id: 'b', name: 'B', root: '/B' },
  ]
  workspace.activeSpaceId = 'b'
})

const read = (text: string) => readingHtml({ text, path: '/A/Note.md' }, 'light', true)

test("a query fence in a note of A, read while B is in front, lists A's notes", async () => {
  const html = await read('# Note\n\n```query\nplan\n```\n')

  expect(searched).toEqual(['/A'])
  expect(html).toContain('data-path="/A/Plan.md"')
})

test("a tasks fence there is answered from A's rows", async () => {
  await read('# Note\n\n```tasks\nnot done\n```\n')

  expect(rowsOf).toEqual(['A'])
})
