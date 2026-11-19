import { beforeEach, expect, test, vi } from 'vitest'
import { memoryStorage } from './disk'

vi.mock('../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/platform/src/tauri')>()),
  invoke: () => Promise.resolve(undefined),
}))
const searched: string[] = []
vi.mock('../src/lib/search/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/search/src/api')>()),
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
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('../src/lib/workspace/src/api')
const { readingHtml } = await import('../src/lib/reading/src/render')
const { serveLinks } = await import('../src/lib/link-index/src/api')
serveLinks({ search: (await import('../src/lib/search/src/api')).searchSpace })
beforeEach(() => {
  searched.length = 0
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
