import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import CanvasFind from '../../src/lib/CanvasFind.svelte'
import { emptyCanvas } from '../../src/lib/canvas/format'

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
  const { matches } = await import('../../src/lib/canvas/find')
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
