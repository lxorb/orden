import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Capture } from './capture'
import { Session } from './listening'
import { joined, RATE, room, voice } from './sound.fixture'

interface Asked {
  seconds: number
  prompt: string
  tries: number
}

let box: HTMLElement
let field: HTMLTextAreaElement
let asked: Asked[]
let answer: (asked: Asked) => string | Promise<string>
let stopped: boolean
let feeding: ((samples: Float32Array) => void) | null
let trouble: string[]
let ended: number

const opens = (heard: (samples: Float32Array) => void): Promise<Capture> => {
  let store: Float32Array = new Float32Array(0)
  feeding = (samples) => {
    for (let at = 2048; at < samples.length + 2048; at += 2048) {
      store = samples.subarray(0, Math.min(at, samples.length))
      heard(store)
    }
  }
  return Promise.resolve({ samples: () => store, stop: () => (stopped = true) })
}

const hears = async (samples: Float32Array, prompt: string, tries: number) => {
  const one = { seconds: samples.length / RATE, prompt, tries }
  asked.push(one)
  return answer(one)
}

function session(words: readonly string[] = [], every = 0): Session {
  return new Session(
    field,
    words,
    hears,
    every,
    {
      level: () => undefined,
      full: () => undefined,
      ended: () => ended++,
      trouble: (said) => trouble.push(said),
    },
    opens,
  )
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  box = document.createElement('div')
  field = document.createElement('textarea')
  box.append(field)
  document.body.append(box)
  Object.defineProperty(field, 'offsetParent', { get: () => box })
  field.value = 'Notiz: '
  field.focus()
  field.setSelectionRange(7, 7)
  asked = []
  answer = () => 'live words'
  stopped = false
  feeding = null
  trouble = []
  ended = 0
})

afterEach(() => box.remove())

describe('a dictation', () => {
  test('shows live words as live while the voice goes on', async () => {
    const one = session()
    await one.open()
    feeding?.(joined(room(0.5), voice(2)))
    await settled()
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((pass) => pass.tries === 1)).toBe(true)
    expect(field.value).toBe('Notiz: live words')
    expect(box.querySelector('[data-heard] mark')?.textContent).toBe('live words')
  })

  test('writes the final words in place of the live ones, heard whole, as plain text', async () => {
    const one = session(['Weißmüller'])
    await one.open()
    feeding?.(joined(room(0.5), voice(3), room(0.5)))
    await settled()
    answer = () => 'Frag Jürgen Weißmüller.'
    asked = []
    await one.finish()

    expect(stopped).toBe(true)
    expect(asked).toHaveLength(1)
    expect(asked[0]!.seconds).toBeGreaterThan(3)
    expect(asked[0]!.seconds).toBeLessThan(4)
    expect(asked[0]!.tries).toBe(3)
    expect(asked[0]!.prompt).toBe('Weißmüller. Notiz:')
    expect(field.value).toBe('Notiz: Frag Jürgen Weißmüller.')
    expect(box.querySelector('[data-heard]')).toBeNull()
  })

  test('sends nothing for silence, and leaves the field as it was', async () => {
    const one = session()
    await one.open()
    feeding?.(room(4))
    await settled()
    await one.finish()
    expect(asked).toEqual([])
    expect(field.value).toBe('Notiz: ')
  })

  test('drops what silence comes back as', async () => {
    answer = () => 'Untertitel der Amara.org-Community'
    const one = session()
    await one.open()
    feeding?.(joined(room(0.5), voice(1.5)))
    await settled()
    await one.finish()
    expect(field.value).toBe('Notiz: ')
  })

  test('puts the field back on Escape, and closes the microphone', async () => {
    const one = session()
    await one.open()
    feeding?.(joined(room(0.5), voice(2)))
    await settled()
    one.cancel()
    expect(stopped).toBe(true)
    expect(field.value).toBe('Notiz: ')
  })

  test('ends a stretch at a pause and goes on after it', async () => {
    let count = 0
    answer = (pass) => (pass.seconds > 4 ? 'Erster Satz.' : `weiter ${++count}`)
    const one = session()
    await one.open()
    feeding?.(joined(voice(4.5), room(1.2), voice(1.5)))
    await settled()
    expect(field.value).toMatch(/^Notiz: Erster Satz\. weiter \d+$/)
  })

  test('stops the live words when a live pass fails, and still writes the final ones', async () => {
    answer = () => Promise.reject(new Error('the network'))
    const one = session()
    await one.open()
    feeding?.(joined(room(0.5), voice(2)))
    await settled()
    const live = asked.length
    feeding?.(joined(room(0.5), voice(4)))
    await settled()
    expect(asked.length).toBe(live)

    answer = () => 'Endlich.'
    await one.finish()
    expect(field.value).toBe('Notiz: Endlich.')
    expect(trouble).toEqual([])
  })

  test('keeps the live words as plain text when the final pass fails, and says why', async () => {
    const one = session()
    await one.open()
    feeding?.(joined(room(0.5), voice(2)))
    await settled()
    answer = () => Promise.reject(new Error('That key was refused.'))
    await one.finish()
    expect(field.value).toBe('Notiz: live words')
    expect(box.querySelector('[data-heard]')).toBeNull()
    expect(trouble).toEqual(['That key was refused.'])
  })

  test('waits between live passes as long as its road asks', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const one = session([], 2_500)
    await one.open()
    feeding?.(joined(room(0.5), voice(3)))
    await settled()
    expect(asked).toHaveLength(1)
    vi.restoreAllMocks()
  })

  test('ends when the reader types into its words, leaving them as they are', async () => {
    const one = session()
    await one.open()
    feeding?.(joined(room(0.5), voice(2)))
    await settled()
    field.value = 'Notiz: lively words'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    expect(ended).toBe(1)
    expect(stopped).toBe(true)
    expect(field.value).toBe('Notiz: lively words')
  })
})
