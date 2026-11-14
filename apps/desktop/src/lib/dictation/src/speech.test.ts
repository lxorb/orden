import { describe, expect, test } from 'vitest'
import { joined, RATE, room, voice } from './sound.fixture'
import { Ear, FRAME, meter } from './speech'

function heard(samples: Float32Array): Ear {
  const ear = new Ear()
  for (let at = 2048; at < samples.length + 2048; at += 2048) ear.hear(samples.subarray(0, at))
  return ear
}

const frames = (seconds: number) => Math.round((seconds * RATE) / FRAME)

describe('the ear', () => {
  test('hears nobody in a quiet room, however long', () => {
    const ear = heard(room(6))
    expect(ear.saysAnything(0, ear.levels.length)).toBe(false)
    expect(ear.trimmed(0, ear.levels.length)).toBeNull()
  })

  test('nor in a loud one: the room is what is measured against', () => {
    const ear = heard(room(6, 0.03))
    expect(ear.saysAnything(0, ear.levels.length)).toBe(false)
  })

  test('hears a voice in it, and trims the stretch to the voice with a margin', () => {
    const ear = heard(joined(room(2), voice(1.5), room(2)))
    const all = ear.levels.length
    expect(ear.saysAnything(0, all)).toBe(true)
    const span = ear.trimmed(0, all)
    expect(span).not.toBeNull()
    expect(span!.from).toBeGreaterThan(frames(1.5))
    expect(span!.from).toBeLessThan(frames(2))
    expect(span!.to).toBeGreaterThan(frames(3.5))
    expect(span!.to).toBeLessThan(frames(4.2))
  })

  test('takes a click for nothing', () => {
    const ear = heard(joined(room(2), voice(0.1), room(2)))
    expect(ear.saysAnything(0, ear.levels.length)).toBe(false)
  })

  test('ends a stretch at a pause once it is long enough, in the pause', () => {
    const ear = heard(joined(voice(4.5), room(1.2), voice(1)))
    const end = ear.endOf(0, ear.levels.length)
    expect(end).not.toBeNull()
    expect(end!).toBeGreaterThan(frames(4.5))
    expect(end!).toBeLessThan(frames(5.7))
  })

  test('but not a short one, and not at a breath', () => {
    expect(heard(joined(voice(2), room(1.2), voice(1))).endOf(0, frames(4.2))).toBeNull()
    const breath = heard(joined(voice(4.5), room(0.3), voice(2)))
    expect(breath.endOf(0, breath.levels.length)).toBeNull()
  })

  test('ends a stretch with no pause in it once it is too long', () => {
    const ear = heard(voice(26))
    expect(ear.endOf(0, frames(20))).toBeNull()
    expect(ear.endOf(0, ear.levels.length)).not.toBeNull()
  })

  test('cuts a long utterance into pieces no longer than asked, at its quiet frames', () => {
    const ear = heard(joined(voice(50), room(1), voice(40)))
    const pieces = ear.piecesOf(0, ear.levels.length, frames(60))
    expect(pieces.length).toBe(2)
    expect(pieces[0]!.to).toBeGreaterThan(frames(50))
    expect(pieces[0]!.to).toBeLessThan(frames(51))
    expect(pieces[1]!.to).toBe(ear.levels.length)
    for (const one of pieces) expect(one.to - one.from).toBeLessThanOrEqual(frames(60))
  })

  test('leaves a short one whole', () => {
    const ear = heard(voice(10))
    expect(ear.piecesOf(0, ear.levels.length, frames(60))).toEqual([
      { from: 0, to: ear.levels.length },
    ])
  })
})

describe('the meter', () => {
  test('reads a quiet room as nothing and a voice up close as all', () => {
    expect(meter(0)).toBe(0)
    expect(meter(0.001)).toBe(0)
    expect(meter(0.2)).toBe(1)
    expect(meter(0.02)).toBeGreaterThan(0.3)
    expect(meter(0.02)).toBeLessThan(0.7)
  })
})
