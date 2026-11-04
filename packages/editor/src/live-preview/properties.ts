/** A note's front matter, drawn as a strip at the top of the note: one quiet line
 *  saying what the note carries, which opens into the rows it says - and is edited in
 *  them. Obsidian's and Notion's properties, in the note rather than in a panel beside
 *  it (#1120): the metadata is about this note, so it is read and changed where the
 *  note is.
 *
 *  Folded, the strip is the word, the count and the keys with their values on one line
 *  that ends where the column does, so a note opens on its words and not on a form.
 *  Open, each row's value is the control its shape asks for: a field for a word, a
 *  number field for a number, a date picker for a date, a real checkbox for a `true`,
 *  chips with an `x` each and a field to add one for a list, and a menu where the key is
 *  one the app has a fixed set of answers for. What every one of them writes is
 *  plain front matter - `tags: [one, two]`, `done: true`, `due: 2026-09-14` - through
 *  property-edits.ts in @orden/markdown, which is built on `frontMatterEdit`. So the
 *  file stays a file every other reader can read, and nothing here can write a shape
 *  the rows could not read back.
 *
 *  The source is still one caret away: clicking a row's key puts the caret on that
 *  row's own line, and the whole block gives way to the YAML it is written in, which is
 *  where a key is renamed or taken out. The reader who wants the source all the time,
 *  or none of it, says so once in Settings; see `propertiesMode` in blocks.ts and
 *  properties.ts in @orden/markdown.
 *
 *  Whether the strip is open is the note's state and not the file's: it is how this
 *  note is being read, and writing it down would be a change to a file nobody changed.
 *
 *  One document change per gesture, on the change rather than per keystroke for a
 *  field, so a value typed into a row is one thing to undo. A block holding a shape
 *  @orden/markdown cannot read stays source, whole; see properties.ts there. */

import {
  EditorSelection,
  type EditorState,
  Facet,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { CHEVRON } from '@orden/markdown/icons'
import { type Property, propertiesTable, readProperties } from '@orden/markdown/properties'
import {
  type ListItem,
  withItem,
  withoutItem,
  writeList,
  writeProperty,
} from '@orden/markdown/property-edits'
import { iconElement } from '../icon'
import { label } from '../labels'
import { applied, clearOfBlock } from './front-matter'
import { drawnAs, frontMatterSpan, showFrontMatter } from './hidden-front-matter'
import { pressedByKey } from '../press'
import { NibWidget } from './widget'

/** The keys the app knows a fixed set of answers for, so a row offers a menu rather
 *  than a field somebody has to spell something into.
 *
 *  Supplied by the host, because which answers are fixed is the app's business and
 *  not the editor's: the accent names, the paper sizes. An empty map is every key
 *  being anybody's to write, which is what the editor on its own says. */
export const propertyChoices = Facet.define<
  Record<string, readonly string[]>,
  Record<string, readonly string[]>
>({ combine: (values) => values[0] ?? {} })

/** Opens the strip, or folds it again. */
export const openProperties = StateEffect.define<boolean>()

/** Whether the note's strip is open. Folded is where every note starts. */
export const propertiesOpen = StateField.define<boolean>({
  create: () => false,
  update(open, transaction) {
    for (const effect of transaction.effects) if (effect.is(openProperties)) open = effect.value
    return open
  },
})

/** Whether the strip opened or folded, which changes what is drawn without the note
 *  moving. */
export function openedChanged(before: EditorState, after: EditorState): boolean {
  return before.field(propertiesOpen, false) !== after.field(propertiesOpen, false)
}

export class PropertiesWidget extends NibWidget {
  constructor(
    private readonly source: string,
    private readonly open = false,
  ) {
    super()
  }

  override eq(other: PropertiesWidget) {
    return other.source === this.source && other.open === this.open
  }

  toDOM(view: EditorView) {
    const host = document.createElement('div')
    host.className = 'nib-properties'
    host.dataset.open = String(this.open)

    const properties = readProperties(this.source)
    if (properties === null) return host

    host.append(head(view, properties, this.open))
    if (!this.open) return host

    const rows = document.createElement('div')
    // The renderer's own markup, out of escaped text; see properties.ts in
    // @orden/markdown. The reading view draws the same rows from the same string, and
    // the controls below are put into the cells it left.
    rows.innerHTML = propertiesTable(properties)
    host.append(...rows.childNodes)

    // The block sits at the top of the note, so the offsets the rows carry are
    // the offsets in the document.
    host.addEventListener('mousedown', (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      // A press inside a control belongs to the control; the key and the space
      // beside it are the way back to the source.
      if (target.closest('.property-value')) return

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

    const choices = view.state.facet(propertyChoices)
    for (const [at, row] of [...host.querySelectorAll('.property')].entries()) {
      const property = properties[at]
      const cell = row.querySelector('.property-value')
      if (!property || !(cell instanceof HTMLElement)) continue
      control(view, property, cell, choices[property.key] ?? null)
    }

    if (!view.state.readOnly) host.append(adder(view))
    return host
  }

  /** The rows are the widget's own: it runs the controls in them and puts the caret
   *  where a click on a key asked. */
  override ignoreEvent() {
    return true
  }
}

/** The strip's own line: the chevron, the word, how many, and folded the keys with
 *  what they say, so the line is worth reading without opening it. A button, so the
 *  keyboard opens it the way a pointer does. */
function head(view: EditorView, properties: readonly Property[], open: boolean): HTMLElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'nib-properties-head'
  button.setAttribute('aria-expanded', String(open))

  const name = document.createElement('span')
  name.className = 'nib-properties-name'
  name.textContent = label('properties')

  const count = document.createElement('span')
  count.className = 'nib-properties-count'
  count.textContent = String(properties.length)

  button.append(iconElement(CHEVRON, 'nib-properties-chevron'), name, count)

  if (!open && properties.length) {
    const said = document.createElement('span')
    said.className = 'nib-properties-said'
    for (const property of properties) {
      const pair = document.createElement('span')
      pair.className = 'nib-properties-pair'
      const key = document.createElement('span')
      key.className = 'nib-properties-key'
      key.textContent = property.key
      pair.append(key, ` ${summary(property)}`)
      said.append(pair)
    }
    button.append(said)
  }

  const toggle = (keyed: boolean) => {
    view.dispatch({ effects: openProperties.of(!open) })
    // The strip is drawn again, so a keyboard that was on it goes to the new one's
    // line. A pointer's press leaves the caret where it was, as every button in a
    // note does.
    if (keyed) focusHead(view)
  }
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    toggle(false)
  })
  pressedByKey(button, () => toggle(true))
  return button
}

/** What a folded row says after its key: the value, or a list's items. */
function summary(property: Property): string {
  if (property.kind === 'list' || property.kind === 'map') return property.items.join(', ')
  return property.value
}

/** The keyboard on the strip's line, once it is drawn. */
function focusHead(view: EditorView, then?: (strip: HTMLElement) => void) {
  const reach = () => {
    const strip = view.dom.querySelector<HTMLElement>('.nib-properties')
    const line = strip?.querySelector<HTMLElement>('.nib-properties-head')
    if (!strip || !line) return false
    line.focus({ preventScroll: true })
    then?.(strip)
    return true
  }
  // Drawn in the dispatch when the top of the note is on screen; a note scrolled a
  // long way down draws it once the scroll has measured.
  if (!reach()) requestAnimationFrame(() => void reach())
}

/** "Show properties": the strip opened at the top of the note and the keyboard on
 *  it. Where the reader keeps the front matter as YAML, or keeps it off the page, the
 *  caret goes into the YAML instead, shown for as long as it stays there; see
 *  `insertFrontMatter`. A note with none gets its first one, which is the one thing
 *  asking to see them can mean there. */
export function showProperties(view: EditorView): boolean {
  const state = view.state
  if (!frontMatterSpan(state)) return newProperty(view)

  const source = state.doc.toString()
  if (drawnAs(state) !== 'properties' || readProperties(source) === null) {
    const inside = state.doc.line(Math.min(2, state.doc.lines))
    view.dispatch({
      selection: EditorSelection.cursor(inside.to),
      effects: showFrontMatter.of(null),
      scrollIntoView: true,
    })
    view.focus()
    return true
  }

  // Out of the block first: a caret in it is the YAML, and the strip is not drawn.
  const span = frontMatterSpan(state)
  const caret = state.selection.main.head
  view.dispatch({
    effects: [openProperties.of(true), EditorView.scrollIntoView(0, { y: 'start' })],
    ...(span && caret <= span.end ? { selection: EditorSelection.cursor(span.after) } : {}),
  })
  focusHead(view)
  return true
}

/** "Add a property": a new key at the foot of the note's front matter, or the block
 *  itself where the note has none, with its placeholder name selected so what is
 *  typed names it. Written in the YAML, which is shown for as long as the caret stays
 *  there, because naming a key is writing a word and the YAML is where words are
 *  written. */
export function newProperty(view: EditorView): boolean {
  const state = view.state
  if (state.readOnly) return false

  const doc = state.doc
  const source = doc.toString()
  const taken = new Set((readProperties(source) ?? []).map((one) => one.key.toLowerCase()))
  let number = taken.size + 1
  while (taken.has(`${label('property')}${number}`.toLowerCase())) number++
  const name = `${label('property')}${number}`

  const close = closingFence(state)
  const from = close === null ? 0 : doc.line(close).from
  const insert = close === null ? `---\n${name}: \n---\n\n` : `${name}: \n`
  const start = from + (close === null ? 4 : 0)

  view.dispatch({
    changes: { from, insert },
    selection: EditorSelection.range(start, start + name.length),
    effects: showFrontMatter.of(null),
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
  return true
}

/** Writes one property and answers whether anything changed, so a control that was
 *  put back where it was costs no undo step. */
function write(view: EditorView, property: Property, value: string | null): boolean {
  if (view.state.readOnly) return false

  const source = view.state.doc.toString()
  const edit = writeProperty(source, property.key, value, property.kind)
  if (!edit) return false

  const keep = clearOfBlock(view, applied(source, edit))
  view.dispatch({
    changes: edit,
    ...(keep ? { selection: keep } : {}),
    userEvent: 'input.property',
  })
  return true
}

function writeItems(view: EditorView, key: string, items: readonly ListItem[] | null): boolean {
  if (view.state.readOnly || items === null) return false

  const source = view.state.doc.toString()
  const edit = writeList(source, key, items)
  if (!edit) return false

  const keep = clearOfBlock(view, applied(source, edit))
  view.dispatch({
    changes: edit,
    ...(keep ? { selection: keep } : {}),
    userEvent: 'input.property',
  })
  return true
}

/** The control a row's value is edited in, put into the cell the renderer drew.
 *
 *  The drawn value is replaced rather than decorated, so a row is the control and not
 *  a control beside a copy of the same words. Read-only leaves the cell exactly as
 *  the renderer left it: a note nobody may write is a note nobody may write. */
function control(
  view: EditorView,
  property: Property,
  cell: HTMLElement,
  choices: readonly string[] | null,
) {
  if (view.state.readOnly) return

  if (property.kind === 'list') {
    cell.replaceChildren(...chips(view, property), adderField(view, property))
    return
  }

  // A map is Orden's own `export:` page setup, whose pairs are two keys deep. Left as
  // the chips it is drawn as: what a nested key means is the surface's business that
  // wrote it, and a control that guessed would write a shape the rows cannot read.
  if (property.kind === 'map') return

  cell.replaceChildren(choices ? menu(view, property, choices) : field(view, property))
}

/** A list's items, each with the `x` that takes it off. */
function chips(view: EditorView, property: Property): HTMLElement[] {
  return property.items.map((item) => {
    const chip = document.createElement('span')
    chip.className = 'property-chip'
    chip.textContent = item

    const off = document.createElement('button')
    off.type = 'button'
    off.className = 'property-chip-off'
    off.title = label('removeFromList')
    off.setAttribute('aria-label', label('removeFromList'))
    off.textContent = '×'

    const take = () => writeItems(view, property.key, withoutItem(property, item))
    off.addEventListener('mousedown', (event) => {
      event.preventDefault()
      take()
    })
    pressedByKey(off, take)

    chip.append(off)
    return chip
  })
}

/** The field at the end of a list that adds another item. Written on Enter and on
 *  leaving it, which is the two ways somebody finishes typing a tag. */
function adderField(view: EditorView, property: Property): HTMLElement {
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'property-add'
  input.placeholder = label('addToList')
  input.setAttribute('aria-label', label('addToList'))

  const add = () => {
    const said = input.value
    input.value = ''
    if (writeItems(view, property.key, withItem(property, said))) view.focus()
  }

  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    add()
  })
  input.addEventListener('blur', add)

  return input
}

/** The field, the number field, the date picker or the checkbox a value's own shape
 *  asks for. One element either way, so the row stays a row. */
function field(view: EditorView, property: Property): HTMLElement {
  if (property.kind === 'checkbox') {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'property-box nib-checkbox'
    box.checked = property.value.toLowerCase() === 'true'
    box.setAttribute('aria-label', property.key)

    box.addEventListener('change', () => {
      write(view, property, box.checked ? 'true' : 'false')
    })

    return box
  }

  const input = document.createElement('input')
  input.className = 'property-field'
  input.value = property.value
  input.setAttribute('aria-label', property.key)

  // A date picker for a date, and the browser's own: it knows the reader's calendar,
  // their week's first day and their language, none of which is worth writing again.
  // `datetime-local` where the value carries a time, since a date field would drop it.
  if (property.kind === 'date') input.type = property.value.length > 10 ? 'datetime-local' : 'date'
  else if (property.kind === 'number') input.type = 'number'
  else input.type = 'text'

  if (input.type === 'datetime-local') input.value = property.value.replace(' ', 'T')

  // On change rather than on every keystroke: a value typed into a row is one thing
  // to undo, and a document rewritten per letter would move the caret out of the
  // field it is being typed in.
  input.addEventListener('change', () => {
    const said = input.type === 'datetime-local' ? input.value.replace('T', ' ') : input.value
    write(view, property, said === '' ? null : said)
  })

  return input
}

/** A menu, where the key is one the app has a fixed set of answers for. The value
 *  the note already carries is offered too even where it is not one of them: a note
 *  that says something this build has not heard of is not corrected by being looked
 *  at. */
function menu(view: EditorView, property: Property, choices: readonly string[]): HTMLElement {
  const select = document.createElement('select')
  select.className = 'property-menu'
  select.setAttribute('aria-label', property.key)

  const said = property.value
  for (const one of choices.includes(said) || said === '' ? choices : [said, ...choices]) {
    const option = document.createElement('option')
    option.value = one
    option.textContent = one
    select.append(option)
  }

  select.value = said
  select.addEventListener('change', () => {
    write(view, property, select.value === '' ? null : select.value)
  })

  return select
}

/** The one affordance the open strip adds: a new key, on a line of its own, with its
 *  name selected. A row rather than a plus in a corner, so it is where the next row
 *  would go and reads as the empty line at the end of a list. */
function adder(view: EditorView): HTMLElement {
  const button = document.createElement('button')
  button.className = 'nib-property-add nib-row is-short'
  button.type = 'button'
  button.textContent = label('addProperty')

  const add = () => newProperty(view)
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    add()
  })
  pressedByKey(button, add)

  return button
}

/** Which line the block's closing `---` is on, or null when the note has no
 *  block. Read from the text, by the same reading of front matter every reader of a
 *  note shares: the closing fence is the one place a new key is certainly still inside
 *  the block, since a block may hold blank lines the rows do not. */
function closingFence(state: EditorState): number | null {
  const doc = state.doc
  const block = frontMatterBlock(doc.toString())
  return block && doc.lineAt(block.close).number
}
