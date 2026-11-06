import { afterEach, expect, test } from 'vitest'
import { keyboardStays, staysOn } from '../../src/lib/caret'

afterEach(() => document.body.replaceChildren())

function row() {
  const one = document.body.appendChild(document.createElement('button'))
  one.focus()
  staysOn(one)
  return one
}

test('while the keyboard is still where the key left it', () => {
  row()
  expect(keyboardStays()).toBe(true)
})

test('not once it has moved on', () => {
  row()
  document.body.appendChild(document.createElement('button')).focus()
  expect(keyboardStays()).toBe(false)
})

test('not once a key has been pressed there', () => {
  row().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(keyboardStays()).toBe(false)
})

test('not once a pointer has pressed it', () => {
  row().dispatchEvent(new Event('pointerdown', { bubbles: true }))
  expect(keyboardStays()).toBe(false)
})
