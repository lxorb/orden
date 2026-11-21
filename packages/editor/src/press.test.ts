// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { pressedByPointer } from './press'

const thrown: unknown[] = []
const caught = (event: ErrorEvent) => {
  thrown.push(event.error)
  event.preventDefault()
}
beforeEach(() => window.addEventListener('error', caught))
afterEach(() => {
  window.removeEventListener('error', caught)
  thrown.length = 0
})
function pressable(): { node: HTMLElement; pressed: number[] } {
  const node = document.createElement('div')
  document.body.append(node)
  const pressed: number[] = []
  pressedByPointer(node, (event) => pressed.push(event.clientY))
  return { node, pressed }
}
function pointer(type: string, fields: { kind?: string; id?: number; x?: number; y?: number } = {}): Event {
  const event = new MouseEvent(type, {
    button: 0,
    bubbles: true,
    cancelable: true,
    clientX: fields.x ?? 0,
    clientY: fields.y ?? 0,
  })
  const own: PropertyDescriptorMap = {}
  if (fields.kind !== undefined) own.pointerType = { value: fields.kind }
  if (fields.id !== undefined) own.pointerId = { value: fields.id }
  return Object.defineProperties(event, own)
}
describe('a press by pointer', () => {
  test('a move or lift with no press before it does nothing and throws nothing', () => {
    const { node, pressed } = pressable()
    node.dispatchEvent(pointer('pointermove'))
    node.dispatchEvent(pointer('pointerup'))
    node.dispatchEvent(new Event('pointermove'))
    node.dispatchEvent(new Event('pointerup'))
    expect(pressed).toEqual([])
    expect(thrown).toEqual([])
  })
  test('a lift of another pointer than the finger that landed does not press', () => {
    const { node, pressed } = pressable()
    node.dispatchEvent(pointer('pointerdown', { kind: 'touch', id: 3, y: 10 }))
    node.dispatchEvent(pointer('pointerup', { kind: 'touch', id: 4, y: 10 }))
    node.dispatchEvent(pointer('pointerup', { kind: 'touch', y: 10 }))
    expect(pressed).toEqual([])
    expect(thrown).toEqual([])
  })
  test('a finger that lands and lifts in place presses once, on the lift', () => {
    const { node, pressed } = pressable()
    node.dispatchEvent(pointer('pointerdown', { kind: 'touch', id: 3, y: 10 }))
    expect(pressed).toEqual([])
    node.dispatchEvent(pointer('pointermove', { kind: 'touch', id: 3, y: 13 }))
    node.dispatchEvent(pointer('pointerup', { kind: 'touch', id: 3, y: 13 }))
    node.dispatchEvent(pointer('pointerup', { kind: 'touch', id: 3, y: 13 }))
    expect(pressed).toEqual([13])
  })
  test('a finger that moves away before it lifts does not press', () => {
    const { node, pressed } = pressable()
    node.dispatchEvent(pointer('pointerdown', { kind: 'touch', id: 3, y: 10 }))
    node.dispatchEvent(pointer('pointermove', { kind: 'touch', id: 3, y: 60 }))
    node.dispatchEvent(pointer('pointerup', { kind: 'touch', id: 3, y: 10 }))
    expect(pressed).toEqual([])
  })
  test('a mouse presses as its button goes down', () => {
    const { node, pressed } = pressable()
    node.dispatchEvent(pointer('pointerdown', { kind: 'mouse', id: 1, y: 5 }))
    expect(pressed).toEqual([5])
  })
})
