import { afterEach, expect, test } from 'vitest'
import { middleOpens, tabAsk } from '../../src/lib/new-tab'

let row: HTMLButtonElement | null = null
let stop: (() => void) | null = null

function drawn(open: (event: MouseEvent) => void) {
  row = document.createElement('button')
  document.body.append(row)
  const action = middleOpens(row, open)
  stop = () => action.destroy()
  return row
}

afterEach(() => {
  stop?.()
  row?.remove()
  row = null
})

test('the middle button opens, and asks for a tab behind', () => {
  const asked: string[] = []
  const button = drawn((event) => asked.push(tabAsk(event)))

  button.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))
  expect(asked).toEqual(['behind'])
})

test('with Shift it asks for one in front', () => {
  const asked: string[] = []
  const button = drawn((event) => asked.push(tabAsk(event)))

  button.dispatchEvent(
    new MouseEvent('auxclick', { button: 1, shiftKey: true, bubbles: true, cancelable: true }),
  )
  expect(asked).toEqual(['front'])
})

test('its press does nothing of the platform’s own', () => {
  const button = drawn(() => undefined)
  const press = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true })

  button.dispatchEvent(press)
  expect(press.defaultPrevented).toBe(true)
})

test('the other buttons are left to what they already do', () => {
  const asked: string[] = []
  const button = drawn((event) => asked.push(tabAsk(event)))
  const main = new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true })

  button.dispatchEvent(main)
  button.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true }))

  expect(main.defaultPrevented).toBe(false)
  expect(asked).toEqual([])
})
