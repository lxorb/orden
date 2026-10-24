// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest'

/** A hover card over `[[Plan]]` in `A/Note.md` while space B is active, both spaces
 *  holding a Plan.md (B388). The card shows A's Plan, read through A's index; it has to
 *  be A's Plan it writes back to, and only when somebody typed in it. Written to the
 *  active space's path on every close, A's words went over B's note unasked. */

const A = { id: 'a', name: 'A', root: '/home/me/A' }
const B = { id: 'b', name: 'B', root: '/home/me/B' }
const written: { path: string; after: string }[] = []
const asked: string[] = []
const disk: Record<string, string> = {
  '/home/me/A/Plan.md': '# Plan of A\n',
  '/home/me/B/Plan.md': '# Plan of B\n',
}

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [A, B],
    activeSpace: B,
    rootHolding: (path: string | null) =>
      path?.startsWith(`${A.root}/`) ? A.root : path?.startsWith(`${B.root}/`) ? B.root : B.root,
    noteText: (path: string) => Promise.resolve(disk[path] ?? null),
    writeNoteText: (path: string, _before: string, after: string) => {
      written.push({ path, after })
      return Promise.resolve(true)
    },
  },
}))
vi.mock('./sharing.svelte', () => ({
  canWriteAt: (path: string) => {
    asked.push(path)
    return true
  },
  trustsHtmlAt: () => false,
}))
vi.mock('./link-index.svelte', () => ({
  links: {
    index: (path: string) => ({ notes: [], files: [], path, read: () => Promise.resolve(null) }),
  },
}))

const { EditorView } = await import('@nib/editor')
const { mountPreview } = await import('./preview-card')

const settle = () => new Promise((done) => setTimeout(done, 0))

function card() {
  const host = document.createElement('div')
  document.body.append(host)
  const release = mountPreview(
    host,
    { path: 'Plan.md', text: '# Plan of A\n', at: 0, readOnly: false },
    '/home/me/A/Note.md',
  )
  const view = EditorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor') ?? host)
  return { release, view }
}

beforeEach(() => {
  written.length = 0
  asked.length = 0
})

test('a card opened and closed without typing writes nothing', async () => {
  const { release } = card()
  release?.()
  await settle()
  expect(written).toEqual([])
})

test("what is typed in it goes to the note it shows, in the source note's space", async () => {
  const { release, view } = card()
  view?.dispatch({ changes: { from: 12, insert: 'more\n' } })
  release?.()
  await settle()
  expect(written).toEqual([{ path: '/home/me/A/Plan.md', after: '# Plan of A\nmore\n' }])
})
