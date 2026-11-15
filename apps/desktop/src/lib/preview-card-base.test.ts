// @vitest-environment jsdom
import { EditorView } from '@orden/editor'
import { expect, test, vi } from 'vitest'

const home = { name: 'Home', root: '/s/Home' }
const written = vi.hoisted(() => [] as { before: string; after: string }[])

vi.mock('./workspace/src/api', () => ({
  followHref: () => undefined,
  workspace: {
    spaces: [home],
    activeSpace: home,
    rootHolding: () => home.root,
    noteText: () => Promise.resolve('# Linked\nfrom them\n'),
    writeNoteText: (_path: string, before: string, after: string) => {
      written.push({ before, after })
      return Promise.resolve(true)
    },
  },
}))

vi.mock('./sharing/src/api', () => ({
  canWriteAt: () => true,
  trustsHtmlAt: () => false,
}))

vi.mock('./link-index/src/api', () => ({
  links: {
    index: (path: string) => ({ notes: [], files: [], path, read: () => Promise.resolve(null) }),
  },
}))

const { mountPreview } = await import('./preview-card')

test('words typed in a glance are written over the note it opened on, so words written elsewhere meanwhile stay', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const release = mountPreview(
    host,
    { path: 'Linked.md', text: '# Linked\n', at: 0, readOnly: false },
    '/s/Home/Note.md',
  )
  const editor = host.querySelector('.cm-editor')
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
  if (!release || !view) throw new Error('no card')

  view.dispatch({ changes: { from: view.state.doc.length, insert: 'mine' } })
  release()
  await new Promise((done) => setTimeout(done, 0))

  expect(written).toEqual([{ before: '# Linked\n', after: '# Linked\nmine' }])
})
