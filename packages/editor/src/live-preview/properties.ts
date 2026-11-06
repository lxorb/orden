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

export const propertyChoices = Facet.define<
  Record<string, readonly string[]>,
  Record<string, readonly string[]>
>({ combine: (values) => values[0] ?? {} })

export const openProperties = StateEffect.define<boolean>()

export const propertiesOpen = StateField.define<boolean>({
  create: () => false,
  update(open, transaction) {
    for (const effect of transaction.effects) if (effect.is(openProperties)) open = effect.value
    return open
  },
})

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
    rows.innerHTML = propertiesTable(properties)
    host.append(...rows.childNodes)

    host.addEventListener('mousedown', (event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.closest('.property-value')) return

      const row = target.closest('.property')
      if (!(row instanceof HTMLElement)) return

      const at = Number(row.dataset.from)
      if (!Number.isFinite(at)) return

      event.preventDefault()
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

  override ignoreEvent() {
    return true
  }
}

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
    if (keyed) focusHead(view)
  }
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    toggle(false)
  })
  pressedByKey(button, () => toggle(true))
  return button
}

function summary(property: Property): string {
  if (property.kind === 'list' || property.kind === 'map') return property.items.join(', ')
  return property.value
}

function focusHead(view: EditorView, then?: (strip: HTMLElement) => void) {
  const reach = () => {
    const strip = view.dom.querySelector<HTMLElement>('.nib-properties')
    const line = strip?.querySelector<HTMLElement>('.nib-properties-head')
    if (!strip || !line) return false
    line.focus({ preventScroll: true })
    then?.(strip)
    return true
  }
  if (!reach()) requestAnimationFrame(() => void reach())
}

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

  const span = frontMatterSpan(state)
  const caret = state.selection.main.head
  view.dispatch({
    effects: [openProperties.of(true), EditorView.scrollIntoView(0, { y: 'start' })],
    ...(span && caret <= span.end ? { selection: EditorSelection.cursor(span.after) } : {}),
  })
  focusHead(view)
  return true
}

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

  if (property.kind === 'map') return

  cell.replaceChildren(choices ? menu(view, property, choices) : field(view, property))
}

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

  if (property.kind === 'date') input.type = property.value.length > 10 ? 'datetime-local' : 'date'
  else if (property.kind === 'number') input.type = 'number'
  else input.type = 'text'

  if (input.type === 'datetime-local') input.value = property.value.replace(' ', 'T')

  input.addEventListener('change', () => {
    const said = input.type === 'datetime-local' ? input.value.replace('T', ' ') : input.value
    write(view, property, said === '' ? null : said)
  })

  return input
}

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

function closingFence(state: EditorState): number | null {
  const doc = state.doc
  const block = frontMatterBlock(doc.toString())
  return block && doc.lineAt(block.close).number
}
