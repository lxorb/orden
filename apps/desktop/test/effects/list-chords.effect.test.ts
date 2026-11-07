import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { roving } from '../../src/lib/roving'
import { shortcuts } from '../../src/lib/shortcuts.svelte'
import { spacePicker } from '../../src/lib/space-picker.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

function nothing() {
  return undefined
}

function list(options: Parameters<typeof roving>[1] = {}) {
  const node = document.createElement('ul')
  for (const name of ['Kestrel', 'Read me']) {
    const row = document.createElement('button')
    row.className = 'orden-row'
    row.textContent = name
    node.append(row)
  }

  document.body.append(node)
  const action = roving(node, options)

  return {
    node,
    row: node.querySelector('button')!,
    stop: () => {
      action.destroy?.()
      node.remove()
    },
  }
}

function windowHandler() {
  const handler = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    shortcuts.handle(event, { view: undefined, palette: nothing, fullscreen: nothing })
  }

  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

function pressOn(row: HTMLElement, key: string, held: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...held,
  })
  row.dispatchEvent(event)
  return event
}

let unhandle: () => void

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = nothing
  workspace.panel = null
  unhandle = windowHandler()
})

afterEach(() => {
  unhandle()
  workspace.panel = null
})

test.each([
  ['Ctrl+Space', false],
  ['Ctrl+Shift+Space', true],
])('a list hands %s on, and the space switcher opens', async (_, shiftKey) => {
  const peek = vi.fn()
  const { row, stop } = list({ peek })
  row.focus()

  const event = pressOn(row, ' ', { ctrlKey: true, shiftKey, code: 'Space' })

  expect(peek).not.toHaveBeenCalled()
  expect(event.defaultPrevented).toBe(true)
  await vi.waitFor(() => expect(spacePicker.open).toBe(true))
  spacePicker.dismiss()

  stop()
})

test('and the bare space bar is still the list opening the row it is on', () => {
  const peek = vi.fn()
  const { row, stop } = list({ peek })
  row.focus()

  const event = pressOn(row, ' ', { code: 'Space' })

  expect(peek).toHaveBeenCalledOnce()
  expect(event.defaultPrevented).toBe(true)
  expect(workspace.panel).toBeNull()

  stop()
})

test('a list walks on its own arrows and not on a chord that holds one', () => {
  const { node, row, stop } = list()
  const [first, second] = [...node.querySelectorAll<HTMLElement>('button')]
  row.focus()

  pressOn(row, 'ArrowDown')
  expect(document.activeElement).toBe(second)

  pressOn(second!, 'ArrowUp', { altKey: true })
  expect(document.activeElement).toBe(second)
  expect(document.activeElement).not.toBe(first)

  stop()
})

test('the menu key still belongs to the list', () => {
  const menu = vi.fn()
  const { row, stop } = list({ menu })
  row.focus()

  pressOn(row, 'F10', { shiftKey: true })
  expect(menu).toHaveBeenCalledOnce()

  stop()
})
