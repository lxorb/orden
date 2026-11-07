// @vitest-environment jsdom
import { EditorState, type Range as Ranged } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const UNIT = 'a [b](c) '

function viewOf(count: number): EditorView {
  const doc = UNIT.repeat(count)
  const hidden: Ranged<Decoration>[] = [Decoration.mark({ class: 'whole' }).range(0, doc.length)]
  for (let at = 0; at < doc.length; at += UNIT.length) {
    hidden.push(Decoration.replace({}).range(at + 5, at + 8))
  }
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        EditorView.lineWrapping,
        EditorView.decorations.of(Decoration.set(hidden, true)),
      ],
    }),
    parent: document.body,
  })
  open.push(view)
  return view
}

interface Walking {
  posBefore: (...args: unknown[]) => number
}

interface Tiled {
  cmTile?: Walking
}

function walksWhileTyping(view: EditorView): number {
  const line = view.contentDOM.querySelector<HTMLElement & Tiled>('.cm-line')
  let walking: Walking | null = line?.cmTile ?? null
  while (walking && !Object.prototype.hasOwnProperty.call(walking, 'posBefore')) {
    walking = Object.getPrototypeOf(walking) as Walking | null
  }
  if (!walking) throw new Error('no tile')
  const walker = document.createTreeWalker(view.contentDOM, NodeFilter.SHOW_TEXT)
  let last: Text | null = null
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node as Text
  if (!last) throw new Error('no text')
  const doc = view.state.doc.toString()
  const at = view.posAtDOM(last, last.length)
  const posBefore = walking.posBefore
  let walks = 0
  walking.posBefore = function (this: unknown, ...args: unknown[]) {
    walks++
    return posBefore.apply(this, args)
  }
  try {
    last.nodeValue = `${last.nodeValue ?? ''}q`
    ;(view as unknown as { observer: { flush(): void } }).observer.flush()
  } finally {
    walking.posBefore = posBefore
  }
  expect(view.state.doc.toString()).toBe(`${doc.slice(0, at)}q${doc.slice(at)}`)
  return walks
}

describe('a long line of hidden marks', () => {
  test('reads what was typed in it without walking the line once for every mark', () => {
    const view = viewOf(1_000)
    expect(view.contentDOM.querySelectorAll('.whole > span').length).toBeGreaterThan(500)
    expect(walksWhileTyping(view)).toBeLessThan(50)
  })
})
