// @vitest-environment jsdom
import { EditorView } from '@nib/editor'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The card over a `[[link]]` is read-only wherever what is typed in it could not
 *  be written.
 *
 *  The bug this pins: the card was an editor whatever the space allowed, so in a
 *  space shared to be read a reader could type into it and the words went nowhere -
 *  the write behind it refuses there without a word. And with the window's own
 *  Read-only switch on, the card's write went through. */

const home = { name: 'Home', root: '/s/Home' }
const share = vi.hoisted(() => ({ readOnly: false }))
const written = vi.hoisted(() => [] as string[])

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [home],
    activeSpace: home,
    noteText: () => Promise.resolve('# Linked\n'),
    writeNoteText: (_path: string, _before: string, after: string) => {
      written.push(after)
      return Promise.resolve(true)
    },
  },
}))

vi.mock('./sharing.svelte', () => ({
  canWriteAt: () => !share.readOnly,
  trustsHtmlAt: () => false,
}))

vi.mock('./link-index.svelte', () => ({
  links: {
    index: (path: string) => ({ notes: [], files: [], path, read: () => Promise.resolve(null) }),
  },
}))

const { mountPreview } = await import('./preview-card')

/** Mounts a card and answers its editor and what puts it away. */
function card(readOnly = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const release = mountPreview(host, { path: 'Linked.md', text: '# Linked\n', at: 0, readOnly })
  const editor = host.querySelector('.cm-editor')
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
  if (!release || !view) throw new Error('no card')
  return { view, release }
}

/** Words put in the way a keystroke would, then the card put away, which is when
 *  whatever is unwritten goes to the file. */
async function typeAndClose(one: { view: EditorView; release: () => void }) {
  one.view.dispatch({ changes: { from: one.view.state.doc.length, insert: 'more' } })
  one.release()
  await new Promise((done) => setTimeout(done, 0))
}

beforeEach(() => {
  share.readOnly = false
  written.length = 0
})

describe('the card over a link', () => {
  test('is written in where the note may be written', async () => {
    const one = card()
    expect(one.view.state.readOnly).toBe(false)

    await typeAndClose(one)
    expect(written).toEqual(['# Linked\nmore'])
  })

  test('is read-only in a space shared to be read, and writes nothing', async () => {
    share.readOnly = true
    const one = card()
    expect(one.view.state.readOnly).toBe(true)

    await typeAndClose(one)
    expect(written).toEqual([])
  })

  test('is read-only over a note that is itself read-only, and writes nothing', async () => {
    const one = card(true)
    expect(one.view.state.readOnly).toBe(true)

    await typeAndClose(one)
    expect(written).toEqual([])
  })
})
