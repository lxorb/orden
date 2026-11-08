import { parseCombination, type Platform } from '../keys'
import { isRecord } from '../stored'

export interface Pressed {
  key: string
  code: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  repeat: boolean
  down: boolean
}

export function readPressed(value: unknown): Pressed | null {
  if (!isRecord(value)) return null

  const { key, code, ctrl, shift, alt, repeat, down } = value
  if (typeof key !== 'string' || !key || typeof code !== 'string') return null

  return {
    key,
    code,
    ctrl: ctrl === true,
    shift: shift === true,
    alt: alt === true,
    repeat: repeat === true,
    down: down === true,
  }
}

const played = new WeakSet<Event>()

export function fromPage(event: Event): boolean {
  return played.has(event)
}

export function replay(one: Pressed): void {
  const event = new KeyboardEvent(one.down ? 'keydown' : 'keyup', {
    key: one.key,
    code: one.code,
    ctrlKey: one.ctrl,
    shiftKey: one.shift,
    altKey: one.alt,
    repeat: one.repeat,
    bubbles: true,
    cancelable: true,
  })
  played.add(event)
  document.body.dispatchEvent(event)
}

export interface Taken {
  code: string
  ctrl: boolean
  shift: boolean
  alt: boolean
}

export function takenOf(key: string | null, platform: Platform): Taken | null {
  const combination = key === null ? null : parseCombination(key, platform)
  if (!combination || combination.meta || combination.ctrl === combination.alt) return null

  const letter = /^[a-z]$/.test(combination.key)
  if (!letter && !/^[0-9]$/.test(combination.key)) return null
  const { ctrl, shift, alt } = combination
  const code = letter ? `Key${combination.key.toUpperCase()}` : `Digit${combination.key}`
  return { code, ctrl, shift, alt }
}
