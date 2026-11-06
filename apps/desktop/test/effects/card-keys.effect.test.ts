import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EditorView } from '@orden/editor'
import CanvasNode from '../../src/lib/CanvasNode.svelte'
import { flushCardEdits } from '../../src/lib/canvas/writing'

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

Element.prototype.scrollIntoView = () => undefined

let target: HTMLElement
let close: (() => void) | undefined

let heard: string[]
let left: number
let given: string[]

beforeEach(() => {
  heard = []
  left = 0
  given = []
  target = document.createElement('div')
  target.addEventListener('keydown', (event) => heard.push(event.key))
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

function card() {
  const component = mount(CanvasNode, {
    target,
    props: {
      node: { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 80, text: 'one' },
      canvasPath: '/space/Board.canvas',
      trusted: false,
      root: '/space',
      picked: true,
      editing: true,
      offset: { x: 0, y: 0 },
      ontext: (text: string) => {
        given.push(text)
      },
      onleave: () => {
        left += 1
      },
    },
  })
  close = () => void unmount(component, { outro: false })
  flushSync()

  const box = target.querySelector('.editor')
  if (!box) throw new Error('the card put no editor up')

  return box
}

function press(box: Element, key: string, held: { ctrlKey?: boolean } = {}) {
  const inside = box.querySelector('.cm-content') ?? box
  inside.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }),
  )
}

test('a press that is not Escape reaches what is above the card', () => {
  const box = card()

  press(box, 'Enter')
  press(box, 'b', { ctrlKey: true })
  press(box, 'p', { ctrlKey: true })

  expect(heard).toEqual(['Enter', 'b', 'p'])
})

test('the words in a card can be asked for before the caret has left it', () => {
  const box = card()
  const view = EditorView.findFromDOM(box as HTMLElement)
  if (!view) throw new Error('the card put no editor up')

  view.dispatch({ changes: { from: view.state.doc.length, insert: ' and more' } })
  expect(given).toEqual([])

  flushCardEdits()
  expect(given).toEqual(['one and more'])

  flushCardEdits()
  expect(given).toEqual(['one and more'])
})

test('and Escape is the card leaving, which goes no further', () => {
  const box = card()

  press(box, 'Escape')

  expect(left).toBe(1)
  expect(heard).toEqual([])
})
