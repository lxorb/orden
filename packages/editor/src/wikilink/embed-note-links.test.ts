// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { editorState } from '../editor'
import { parsed } from '../../test/parsed'
import type { NoteIndex, NoteJump } from './notes'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const PLAN = { path: 'Plan.md', name: 'Plan', headings: [], blocks: [], aliases: [] }
const BUDGET = { path: 'Budget.md', name: 'Budget', headings: [], blocks: [], aliases: [] }

const SPACE: NoteIndex = {
  notes: [PLAN, BUDGET],
  files: [],
  path: 'Today.md',
  read: () => Promise.resolve('Read [[Budget]] first.'),
  render: () =>
    Promise.resolve('<p>Read <a class="wikilink" href="Budget.md">Budget</a> first.</p>'),
}

const NOTE = 'Top\n\n![[Plan]]\n\nend\n'

const settle = () => new Promise((done) => setTimeout(done, 20))

describe('a wikilink inside a drawn note embed', () => {
  test('opens its note on Ctrl or Cmd-click, as the same wikilink in the note does', async () => {
    const jumps: NoteJump[] = []
    const view = new EditorView({
      state: parsed(
        editorState({
          doc: NOTE,
          selection: { anchor: NOTE.length },
          notes: SPACE,
          openNote: (jump) => void jumps.push(jump),
        }),
      ),
      parent: document.body,
    })
    open.push(view)
    let anchor: Element | null = null
    for (let tries = 0; tries < 200 && !anchor; tries++) {
      await settle()
      anchor = view.dom.querySelector('.orden-embed-body a[href]')
    }
    if (!anchor) throw new Error('no link drawn in the embed')
    const keys = { bubbles: true, cancelable: true, button: 0, ctrlKey: true, metaKey: true }
    anchor.dispatchEvent(new MouseEvent('mousedown', keys))
    anchor.dispatchEvent(new MouseEvent('click', keys))

    expect(jumps.map((jump) => jump.path)).toEqual(['Budget.md'])
  })
})
