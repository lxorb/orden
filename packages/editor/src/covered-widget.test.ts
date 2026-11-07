// @vitest-environment jsdom
import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

class Gap extends WidgetType {
  constructor(readonly block: boolean) {
    super()
  }

  override eq(other: Gap) {
    return other.block === this.block
  }

  toDOM() {
    const dom = document.createElement(this.block ? 'div' : 'span')
    dom.className = 'gap'
    return dom
  }
}

const shown = StateEffect.define<DecorationSet>()

const below = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(shown)) value = effect.value
    return value.map(tr.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

const DOC = `# Big\n\n${'[a]('.repeat(40)}`
const LINE = 7

function viewWith(above: { from: number; to: number }[]): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [
        EditorView.lineWrapping,
        Prec.highest(
          EditorView.decorations.of(
            Decoration.set(above.map(({ from, to }) => Decoration.replace({}).range(from, to))),
          ),
        ),
        below,
      ],
    }),
    parent: document.body,
  })
  open.push(view)
  return view
}

function lineText(view: EditorView): string {
  return view.contentDOM.querySelectorAll('.cm-line')[2]?.textContent ?? ''
}

describe('a replaced range that starts under one of higher precedence', () => {
  test.each([
    ['at the same place', [{ from: LINE, to: LINE + 1 }], LINE, LINE + 100],
    ['before it', [{ from: LINE, to: LINE + 3 }], LINE + 1, LINE + 100],
    [
      'twice before it',
      [
        { from: LINE, to: LINE + 1 },
        { from: LINE + 1, to: LINE + 2 },
      ],
      LINE,
      LINE + 100,
    ],
  ])('is drawn when it starts %s', (_, above, from, to) => {
    const view = viewWith(above)
    const visible = DOC.slice(to)
    view.dispatch({
      effects: shown.of(
        Decoration.set([Decoration.replace({ widget: new Gap(false) }).range(from, to)]),
      ),
    })
    expect(view.contentDOM.querySelectorAll('.gap')).toHaveLength(1)
    expect(lineText(view)).toBe(visible)
    view.dispatch({ effects: shown.of(Decoration.none) })
    expect(view.contentDOM.querySelectorAll('.gap')).toHaveLength(0)
    expect(lineText(view)).toBe(DOC.slice(LINE).slice(above.reduce((n, r) => n + r.to - r.from, 0)))
  })

  test('is drawn again after the text in it changes', () => {
    const view = viewWith([{ from: LINE, to: LINE + 1 }])
    view.dispatch({
      effects: shown.of(
        Decoration.set([Decoration.replace({ widget: new Gap(false) }).range(LINE, LINE + 100)]),
      ),
    })
    view.dispatch({ changes: { from: DOC.length, insert: 'q' } })
    expect(view.contentDOM.querySelectorAll('.gap')).toHaveLength(1)
    expect(lineText(view)).toBe(`${DOC.slice(LINE + 100)}q`)
  })
})
