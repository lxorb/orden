// A command, profile or style found in a space somebody else can reach says so, and the
// commands take what it asks for as a collaborator's rather than the reader's.

import { expect, test, vi } from 'vitest'

const TEXTS: Record<string, string> = {
  '/own/mine.md': '---\ncommand: mine\nmode: full\n---\nMine.',
  '/team/weekly.md': '---\ncommand: weekly\nmode: full\n---\nPublish.',
}
let root = '/own'

vi.mock('../../link-index.svelte', () => ({ links: { version: 0 } }))
vi.mock('../../workspace.svelte', () => ({
  workspace: {
    get activeSpace() {
      return { root }
    },
    leftOutOf: () => [],
    noteText: (path: string) => Promise.resolve(TEXTS[path] ?? ''),
  },
}))
vi.mock('../../search/space', () => ({
  searchSpace: (
    space: string,
    _query: unknown,
    _terms: unknown,
    _most: number,
    onFound: (found: { hits: { path: string }[] }) => void,
  ) => {
    onFound({
      hits: Object.keys(TEXTS)
        .filter((path) => path.startsWith(`${space}/`))
        .map((path) => ({ path })),
    })
    return Promise.resolve()
  },
}))
vi.mock('../../sharing.svelte', () => ({
  reachedByOthers: (path: string | null) => !!path?.startsWith('/team/'),
}))

const { found } = await import('./found')

test("marks what a space somebody else can reach holds, and nothing of the reader's own", async () => {
  expect((await found()).map((one) => [one.name, one.shared])).toEqual([['mine', false]])
  root = '/team'
  expect((await found()).map((one) => [one.name, one.shared])).toEqual([['weekly', true]])
})
