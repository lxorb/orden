// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { onTwist } from './tree-keys'

document.body.innerHTML = `
  <button class="orden-row row">
    <span class="mark"></span><span class="orden-row-label">Trip</span>
    <span class="orden-row-meta twist"><svg class="turn"><path d="M2 1l3 3-3 3" /></svg></span>
  </button>
`

function pressOn(selector: string): Event {
  const event = new MouseEvent('click', { bubbles: true })
  document.querySelector(selector)?.dispatchEvent(event)
  return event
}

describe('a press', () => {
  test('on the mark, its line or the strip round it is the twist’s', () => {
    expect(onTwist(pressOn('.twist'))).toBe(true)
    expect(onTwist(pressOn('.turn'))).toBe(true)
    expect(onTwist(pressOn('.turn path'))).toBe(true)
  })

  test('on the name or the note’s own mark is the row’s, which opens it', () => {
    expect(onTwist(pressOn('.orden-row-label'))).toBe(false)
    expect(onTwist(pressOn('.mark'))).toBe(false)
    expect(onTwist(new MouseEvent('click'))).toBe(false)
  })
})
