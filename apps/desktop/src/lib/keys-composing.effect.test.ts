import { afterEach, expect, test } from 'vitest'
import { holdComposingKeys } from './ui-kit/src/keys'

let release: (() => void) | null = null

afterEach(() => {
  release?.()
  release = null
  document.body.replaceChildren()
})

function heardIn(field: HTMLElement, init: KeyboardEventInit): boolean {
  let heard = false
  field.addEventListener('keydown', () => (heard = true))
  document.body.addEventListener('keydown', () => (heard = true))
  field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
  return heard
}

function placed<T extends HTMLElement>(field: T, within?: string): T {
  const host = document.createElement('div')
  if (within) host.className = within
  host.append(field)
  document.body.append(host)
  return field
}

const ENDINGS: [string, KeyboardEventInit][] = [
  ['while composing', { key: 'Enter', isComposing: true }],
  ['as WebKit ends a composition', { key: 'Enter', keyCode: 229 }],
  ['as Windows composes', { key: 'Process', keyCode: 229, isComposing: true }],
]

test.each(ENDINGS)('an Enter %s never reaches a field or the window', (_, init) => {
  release = holdComposingKeys()
  expect(heardIn(placed(document.createElement('input')), init)).toBe(false)
  expect(heardIn(placed(document.createElement('textarea')), init)).toBe(false)
})

test('an Enter typed outside a composition reaches the field', () => {
  release = holdComposingKeys()
  expect(heardIn(placed(document.createElement('input')), { key: 'Enter' })).toBe(true)
})

test('an editor and a terminal still hear the keys of a composition, which they follow themselves', () => {
  release = holdComposingKeys()
  const init = { key: 'Enter', keyCode: 229 }
  expect(heardIn(placed(document.createElement('textarea'), 'xterm'), init)).toBe(true)
  expect(heardIn(placed(document.createElement('input'), 'cm-editor'), init)).toBe(true)
  const editable = placed(document.createElement('div'))
  editable.contentEditable = 'true'
  expect(heardIn(editable, init)).toBe(true)
})
