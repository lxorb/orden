// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

beforeAll(() => {
  Range.prototype.getClientRects = () => [new DOMRect(0, 0, 1000, 20)] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

class Carried {
  private held = new Map<string, string>()
  effectAllowed = 'all'
  setData(type: string, value: string) {
    this.held.set(type, value)
  }
  getData(type: string) {
    return this.held.get(type) ?? ''
  }
}

class Dragging extends MouseEvent {
  readonly dataTransfer: Carried
  constructor(type: string, init: MouseEventInit & { dataTransfer: Carried }) {
    super(type, init)
    this.dataTransfer = init.dataTransfer
  }
}

const DOC = 'alpha beta gamma\n\nlast line here'
const BETA = { from: 6, to: 10 }

function pressedInBeta(): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc: DOC, selection: { anchor: BETA.from, head: BETA.to } }),
    parent: document.body,
  })
  open.push(view)
  Object.assign(view, {
    posAndSideAtCoords: ({ y }: { x: number; y: number }) => ({ pos: y > 50 ? 28 : 7, assoc: 1 }),
  })
  view.focus()
  view.contentDOM.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      buttons: 1,
      detail: 1,
      clientX: 70,
      clientY: 10,
    }),
  )
  return view
}

function movedTo(view: EditorView, clientY: number) {
  view.contentDOM.ownerDocument.dispatchEvent(
    new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 70, clientY }),
  )
}

function dragged(view: EditorView): string | null {
  const data = new Carried()
  view.contentDOM.dispatchEvent(new Dragging('dragstart', { bubbles: true, dataTransfer: data }))
  return data.getData('Text') || null
}

describe('a press in the selection that moves far at once', () => {
  test('drags the words selected, when the browser starts a drag right after the move', () => {
    const view = pressedInBeta()
    movedTo(view, 80)
    expect(dragged(view)).toBe('beta')
    expect(view.state.selection.main).toMatchObject(BETA)
  })

  test('selects from the press, when no drag starts', async () => {
    const view = pressedInBeta()
    movedTo(view, 80)
    await new Promise((go) => setTimeout(go, 10))
    expect(view.state.selection.main).toMatchObject({ from: 7, to: 28 })
  })
})
