import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import CanvasFind from '../../src/lib/canvas/src/CanvasFind.svelte'
import { emptyCanvas } from '@orden/markdown/canvas'

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
})

const canvas = {
  ...emptyCanvas(),
  nodes: ['a', 'b', 'c'].map((id, at) => ({
    id,
    type: 'text' as const,
    x: 0,
    y: at * 100,
    width: 250,
    height: 60,
    text: `invoice ${id}`,
  })),
}

function opened(): { picked: string[]; field: HTMLInputElement; count: () => string } {
  const picked: string[] = []
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(CanvasFind, {
    target,
    props: { canvas, onpick: (id: string) => picked.push(id), onclose: () => undefined },
  })
  close = () => void unmount(shown, { outro: false })
  flushSync()
  const field = target.querySelector<HTMLInputElement>('input')
  if (!field) throw new Error('no find field')
  field.value = 'invoice'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  return { picked, field, count: () => target.querySelector('.count')?.textContent ?? '' }
}

function enter(field: HTMLInputElement, shiftKey = false) {
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true }))
  flushSync()
}

test('the first Enter goes to the first card found, and the next ones on in turn', () => {
  const { picked, field, count } = opened()
  enter(field)
  expect(picked).toEqual(['a'])
  expect(count()).toBe('1/3')
  enter(field)
  enter(field)
  enter(field)
  expect(picked).toEqual(['a', 'b', 'c', 'a'])
})

test('the first Shift+Enter goes to the last card found', () => {
  const { picked, field, count } = opened()
  enter(field, true)
  expect(picked).toEqual(['c'])
  expect(count()).toBe('3/3')
})

test('words a card breaks across two lines are found as the card shows them', async () => {
  const { matches } = await import('../../src/lib/canvas/src/find')
  const card = {
    id: 'two',
    type: 'text' as const,
    x: 0,
    y: 0,
    width: 250,
    height: 60,
    text: 'pay the\ninvoice   today',
  }
  const found = matches({ ...canvas, nodes: [card] }, 'the invoice today')
  expect(found).toEqual([{ id: 'two', says: 'pay the invoice today' }])
})

test('Ctrl+F in the find field chooses its word and goes no further', () => {
  const { field } = opened()
  field.setSelectionRange(3, 3)
  const event = new KeyboardEvent('keydown', {
    key: 'f',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  field.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'invoice'.length])
})

test('a hit clicked in the list gives the caret back to the field, so Enter goes on from it', () => {
  const { picked, field, count } = opened()
  const row = document.querySelectorAll<HTMLButtonElement>('.hits button')[1]
  if (!row) throw new Error('no second hit')
  row.focus()
  row.click()
  flushSync()
  expect(picked).toEqual(['b'])
  expect(document.activeElement).toBe(field)

  enter(field)
  expect(picked).toEqual(['b', 'c'])
  expect(count()).toBe('3/3')
})

test('going past the first twelve hits turns the list on to the twelve the hit is in, marked', () => {
  const many = {
    ...emptyCanvas(),
    nodes: Array.from({ length: 30 }, (_, at) => ({
      id: `n${at}`,
      type: 'text' as const,
      x: 0,
      y: at * 100,
      width: 250,
      height: 60,
      text: `invoice ${at}`,
    })),
  }
  const target = document.createElement('div')
  document.body.append(target)
  const picked: string[] = []
  const shown = mount(CanvasFind, {
    target,
    props: { canvas: many, onpick: (id: string) => picked.push(id), onclose: () => undefined },
  })
  close = () => void unmount(shown, { outro: false })
  flushSync()
  const field = target.querySelector<HTMLInputElement>('input')
  if (!field) throw new Error('no find field')
  field.value = 'invoice'
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  for (let step = 0; step < 14; step += 1) enter(field)
  expect(picked.at(-1)).toBe('n13')
  const rows = () => [...target.querySelectorAll<HTMLButtonElement>('.hits button')]
  const marked = () =>
    rows()
      .find((row) => row.classList.contains('on'))
      ?.textContent.trim()
  expect(marked()).toBe('invoice 13')

  const row = rows().find((one) => one.textContent.trim() === 'invoice 15')
  if (!row) throw new Error('no row for the sixteenth hit')
  row.click()
  flushSync()
  expect(picked.at(-1)).toBe('n15')
  enter(field)
  expect(picked.at(-1)).toBe('n16')

  enter(field, true)
  enter(field, true)
  enter(field, true)
  enter(field, true)
  enter(field, true)
  enter(field, true)
  expect(picked.at(-1)).toBe('n10')
  expect(marked()).toBe('invoice 10')
})
