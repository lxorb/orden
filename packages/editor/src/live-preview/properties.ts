/** A note's front matter, drawn as the rows it says rather than as the YAML it
 *  is written in.
 *
 *  A block like every other block here: rendered while the caret is elsewhere,
 *  its own source the moment the caret enters. That rule is the whole design.
 *  Obsidian needs a three-way setting - rows, source, hidden - because its
 *  properties table is a second editor with its own controls, and somebody who
 *  wants the YAML has to be given a way back to it. Here the way back is the way
 *  back to anything: put the caret in it. One editing model, no writer of its
 *  own to keep in step with the note, and the file stays exactly as it was typed.
 *
 *  A click on a row is that same move made shorter: the caret lands on the line
 *  the row was drawn from, which reveals the block with the caret already in the
 *  right place.
 *
 *  What it will not do is guess. A block holding a shape @nib/markdown cannot
 *  read stays source, whole; see properties.ts there. */

import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { propertiesTable, readProperties } from '@nib/markdown/properties'
import { label } from '../labels'
import { pressedByKey } from '../press'
import { NibWidget } from './widget'

export class PropertiesWidget extends NibWidget {
  constructor(private readonly source: string) {
    super()
  }

  override eq(other: PropertiesWidget) {
    return other.source === this.source
  }

  toDOM(view: EditorView) {
    const host = document.createElement('div')
    host.className = 'nib-properties'

    const properties = readProperties(this.source)
    if (properties === null) return host

    // The renderer's own markup, out of escaped text; see properties.ts in
    // @nib/markdown. The reading view draws the same rows from the same string.
    host.innerHTML = propertiesTable(properties)

    // The block sits at the top of the note, so the offsets the rows carry are
    // the offsets in the document.
    host.addEventListener('mousedown', (event) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const row = target.closest('.property')
      if (!(row instanceof HTMLElement)) return

      const at = Number(row.dataset.from)
      if (!Number.isFinite(at)) return

      event.preventDefault()
      // At the end of the key's own line, which is where somebody who clicked a
      // row wants to be: after the value, ready to change it.
      const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length))
      view.dispatch({ selection: EditorSelection.cursor(line.to), scrollIntoView: true })
      view.focus()
    })

    host.append(adder(view, properties.length))
    return host
  }

  /** The rows are the widget's own; the caret is put where a click asked. */
  override ignoreEvent() {
    return true
  }
}

/** The one affordance the block adds: a new key, on a line of its own, with the
 *  caret on it. A row rather than a plus in a corner, so it is where the next row
 *  would go and reads as the empty line at the end of a list. */
function adder(view: EditorView, count: number): HTMLElement {
  const button = document.createElement('button')
  button.className = 'nib-property-add nib-row is-short'
  button.type = 'button'
  button.textContent = label('addProperty')

  const add = () => addProperty(view, count)
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    add()
  })
  pressedByKey(button, add)

  return button
}

/** Writes an empty key in front of the closing fence and puts the caret on it.
 *
 *  In front of the fence rather than after the last row read, because a block
 *  may hold blank lines the rows do not: the fence is the one place a new key is
 *  certainly still inside the block. */
function addProperty(view: EditorView, count: number): void {
  const doc = view.state.doc
  const close = closingFence(view)
  if (close === null) return

  const line = doc.line(close)
  const insert = `${label('property')}${count + 1}: \n`

  view.dispatch({
    changes: { from: line.from, insert },
    selection: EditorSelection.cursor(line.from + insert.length - 1),
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

/** Which line the block's closing `---` is on, or null when the note has no
 *  block. Read from the text: a widget is drawn from a string and the tree it
 *  came from is not in hand. */
function closingFence(view: EditorView): number | null {
  const doc = view.state.doc
  if (doc.line(1).text.trim() !== '---') return null

  for (let number = 2; number <= doc.lines; number++) {
    if (doc.line(number).text.trim() === '---') return number
  }

  return null
}
