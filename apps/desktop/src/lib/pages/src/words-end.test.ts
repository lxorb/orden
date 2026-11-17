// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import { wordsEnd } from './words-end'

function layerOf(lines: string[]) {
  const layer = document.createElement('div')
  layer.className = 'words live'
  for (const line of lines) {
    const span = document.createElement('span')
    span.textContent = line
    layer.append(span)
  }
  document.body.append(layer)
  const spans = [...layer.querySelectorAll('span')]
  return { layer, spans, texts: spans.map((one) => one.firstChild as Text) }
}

function nth<T>(list: T[], index: number): T {
  const one = list[index]
  if (one === undefined) throw new Error(`nothing at ${index}`)
  return one
}

function placed(spans: HTMLElement[]) {
  spans.forEach((span, row) => {
    span.getBoundingClientRect = () => new DOMRect(100, 20 * row, 200, 12)
  })
}

function press(
  target: EventTarget,
  kind: string,
  type = 'pointerdown',
  x = 0,
  y = 0,
  buttons = type === 'pointerup' ? 0 : 1,
) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, buttons, clientX: x, clientY: y })
  Object.defineProperty(event, 'pointerType', { value: kind })
  target.dispatchEvent(event)
}

function choose(from: Text, at: number, to: Text, until: number) {
  getSelection()?.setBaseAndExtent(from, at, to, until)
  document.dispatchEvent(new Event('selectionchange'))
}

const order = (layer: HTMLElement) =>
  [...layer.children].map((one) => (one.className === 'end' ? 'end' : one.textContent))

afterEach(() => {
  getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe('the end of the words a mouse chooses', () => {
  test('follows the line the mouse is on, so dragging past its end keeps all of it', () => {
    const { layer, spans, texts } = layerOf(['Line 1: the field.', 'Line 2: the field.', 'Line 3'])
    const stop = wordsEnd(layer)
    expect(order(layer)).toEqual(['Line 1: the field.', 'Line 2: the field.', 'Line 3', 'end'])

    press(nth(spans, 0), 'mouse')
    expect(layer.classList.contains('selecting')).toBe(true)

    choose(nth(texts, 0), 0, nth(texts, 0), 15)
    expect(order(layer)).toEqual(['Line 1: the field.', 'end', 'Line 2: the field.', 'Line 3'])

    choose(nth(texts, 0), 0, nth(texts, 1), 4)
    expect(order(layer)).toEqual(['Line 1: the field.', 'Line 2: the field.', 'end', 'Line 3'])

    press(document, 'mouse', 'pointerup')
    expect(layer.classList.contains('selecting')).toBe(false)
    expect(order(layer)).toEqual(['Line 1: the field.', 'Line 2: the field.', 'Line 3', 'end'])
    stop()
  })

  test('reaches the last letter of a line when the mouse goes past its end, and the first before its start', () => {
    const { layer, spans, texts } = layerOf(['Line 1: the field.', 'Line 2: the field.'])
    placed(spans)
    const stop = wordsEnd(layer)
    press(nth(spans, 0), 'mouse')
    choose(nth(texts, 0), 0, nth(texts, 0), 15)

    press(document, 'mouse', 'pointermove', 340, 6)
    expect(String(getSelection())).toBe('Line 1: the field.')

    press(document, 'mouse', 'pointermove', 200, 6)
    expect(String(getSelection())).toBe('Line 1: the field.')

    choose(nth(texts, 1), 18, nth(texts, 1), 10)
    press(document, 'mouse', 'pointermove', 40, 26)
    expect(String(getSelection())).toBe('Line 2: the field.')

    press(document, 'mouse', 'pointermove', 340, 16)
    expect(String(getSelection())).toBe('Line 2: the field.')
    stop()
  })

  test('stands before the start when the start is what moves', () => {
    const { layer, spans, texts } = layerOf(['one', 'two', 'three'])
    const stop = wordsEnd(layer)
    press(nth(spans, 2), 'mouse')

    choose(nth(texts, 2), 3, nth(texts, 2), 0)
    choose(nth(texts, 2), 3, nth(texts, 1), 1)
    expect(order(layer)).toEqual(['one', 'end', 'two', 'three'])
    stop()
  })

  test('leaves a pen, a finger and the words of another layer alone', () => {
    const { layer, spans, texts } = layerOf(['one', 'two'])
    const other = layerOf(['elsewhere'])
    const stop = wordsEnd(layer)

    press(nth(spans, 0), 'pen')
    press(nth(spans, 0), 'touch')
    choose(nth(texts, 0), 0, nth(texts, 1), 2)
    expect(layer.classList.contains('selecting')).toBe(false)
    expect(order(layer)).toEqual(['one', 'two', 'end'])

    press(nth(spans, 0), 'mouse')
    choose(nth(other.texts, 0), 0, nth(other.texts, 0), 4)
    expect(order(layer)).toEqual(['one', 'two', 'end'])
    stop()
  })

  test('lets go when the release is lost: a bare mouse move, a cancel or the words dragged away end it', () => {
    for (const ending of ['move', 'pointercancel', 'dragstart']) {
      const { layer, spans, texts } = layerOf(['Line 1: the field.', 'Line 2: the field.'])
      placed(spans)
      const stop = wordsEnd(layer)
      press(nth(spans, 0), 'mouse')
      choose(nth(texts, 0), 0, nth(texts, 0), 4)

      if (ending === 'move') press(document, 'mouse', 'pointermove', 340, 26, 0)
      else document.dispatchEvent(new Event(ending, { bubbles: true }))
      expect(layer.classList.contains('selecting'), ending).toBe(false)

      press(document, 'mouse', 'pointermove', 340, 26, 0)
      expect(String(getSelection()), ending).toBe('Line')
      expect(order(layer).at(-1), ending).toBe('end')
      stop()
      getSelection()?.removeAllRanges()
      document.body.replaceChildren()
    }
  })

  test('is taken away with the words', () => {
    const { layer, spans } = layerOf(['one'])
    const stop = wordsEnd(layer)
    press(nth(spans, 0), 'mouse')
    stop()
    expect(order(layer)).toEqual(['one'])
    expect(layer.classList.contains('selecting')).toBe(false)
  })
})
