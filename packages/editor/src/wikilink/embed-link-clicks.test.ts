// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { editorState } from '../editor'
import { setReadOnlyMode } from '../modes'
import { parsed } from '../../test/parsed'
import type { NoteIndex } from './notes'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const PLAN = { path: 'Plan.md', name: 'Plan', headings: [], blocks: [], aliases: [] }

const SPACE: NoteIndex = {
  notes: [PLAN],
  files: [],
  path: 'Today.md',
  read: () => Promise.resolve('Read [the docs](https://x.test) first.'),
}

const NOTE = 'Top\n\n![[Plan]]\n\nend\n'

const settle = () => new Promise((done) => setTimeout(done, 20))

async function embedLink(readOnly: boolean) {
  const links: string[] = []
  const view = new EditorView({
    state: parsed(
      editorState({
        doc: NOTE,
        selection: { anchor: NOTE.length },
        notes: SPACE,
        openLink: (href) => void links.push(href),
      }),
    ),
    parent: document.body,
  })
  open.push(view)
  if (readOnly) setReadOnlyMode(view, true)
  let anchor: Element | null = null
  for (let tries = 0; tries < 200 && !anchor; tries++) {
    await settle()
    anchor = view.dom.querySelector('.orden-embed-body a[href]')
  }
  if (!anchor) throw new Error('no link drawn in the embed')
  return { anchor, links }
}

function press(target: Element, modified: boolean): MouseEvent {
  const keys = { bubbles: true, cancelable: true, button: 0, ctrlKey: modified, metaKey: modified }
  target.dispatchEvent(new MouseEvent('mousedown', keys))
  target.dispatchEvent(new MouseEvent('mouseup', keys))
  const click = new MouseEvent('click', keys)
  target.dispatchEvent(click)
  return click
}

describe('a web link inside a drawn note embed', () => {
  test('opens through the link opener on Ctrl or Cmd-click, as the same link in the note does', async () => {
    const { anchor, links } = await embedLink(false)
    const click = press(anchor, true)

    expect(links).toEqual(['https://x.test'])
    expect(click.defaultPrevented).toBe(true)
  })

  test('opens through the link opener on a click in Read-only mode', async () => {
    const { anchor, links } = await embedLink(true)
    const click = press(anchor, false)

    expect(links).toEqual(['https://x.test'])
    expect(click.defaultPrevented).toBe(true)
  })

  test('is not left for the browser to follow on a plain click', async () => {
    const { anchor } = await embedLink(false)
    const click = press(anchor, false)

    expect(click.defaultPrevented).toBe(true)
  })
})
