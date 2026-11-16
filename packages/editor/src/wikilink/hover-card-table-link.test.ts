// @vitest-environment jsdom
import { activateHover, EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { editorState } from '../editor'
import { parsed } from '../../test/parsed'
import type { PreviewMount } from './hover'
import type { NoteIndex } from './notes'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
  window.dispatchEvent(new KeyboardEvent('keyup', {}))
})

const PLAN_TEXT = '# Plan\n\n| site | why |\n| - | - |\n| [docs](https://x.test) | read |\n\nend\n'

const PLAN = { path: 'Plan.md', name: 'Plan', headings: [], blocks: [], aliases: [] }

const SPACE: NoteIndex = {
  notes: [PLAN],
  files: [],
  path: 'Today.md',
  read: () => Promise.resolve(PLAN_TEXT),
}

const NOTE = 'See [[Plan]] now.\n\nend\n'

const settle = () => new Promise((done) => setTimeout(done, 20))

async function cardLink() {
  const links: string[] = []
  const mount: PreviewMount = (host, note) => {
    const inner = new EditorView({
      state: parsed(
        editorState({
          doc: note.text,
          selection: { anchor: note.text.length },
          openLink: (href) => void links.push(href),
        }),
      ),
      parent: host,
    })
    open.push(inner)
    return () => inner.destroy()
  }
  const view = new EditorView({
    state: parsed(
      editorState({
        doc: NOTE,
        selection: { anchor: NOTE.length },
        notes: SPACE,
        openLink: (href) => void links.push(href),
        editPreview: mount,
      }),
    ),
    parent: document.body,
  })
  open.push(view)
  window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, metaKey: true }))
  activateHover(view, NOTE.indexOf('Plan'), 1)
  let anchor: Element | null = null
  for (let tries = 0; tries < 100 && !anchor; tries++) {
    await settle()
    anchor = document.querySelector('.orden-note-preview td a[href]')
  }
  if (!anchor) throw new Error('no cell link drawn in the hover card')
  return { anchor, links }
}

function press(target: Element, keys: MouseEventInit) {
  const all = { bubbles: true, cancelable: true, ...keys }
  target.dispatchEvent(new MouseEvent('mousedown', all))
  target.dispatchEvent(new MouseEvent('mouseup', all))
  target.dispatchEvent(new MouseEvent('click', all))
}

describe('a link in a table of the note hover card', () => {
  test('opens once on Ctrl or Cmd-click', async () => {
    const { anchor, links } = await cardLink()
    press(anchor, { button: 0, ctrlKey: true, metaKey: true })
    expect(links).toEqual(['https://x.test'])
  })

  test('opens once on a middle click', async () => {
    const { anchor, links } = await cardLink()
    press(anchor, { button: 1 })
    expect(links).toEqual(['https://x.test'])
  })
})
