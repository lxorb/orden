import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DeviceSession } from './device'

interface Fake {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: unknown) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onspeechstart: (() => void) | null
  onspeechend: (() => void) | null
  started: number
  stopped: number
}

let box: HTMLElement
let field: HTMLTextAreaElement
let made: Fake[]
let levels: number[]
let ended: number
let trouble: string[]
let phone: { on: boolean[]; heard: ((json: string) => void) | null } | null

const hooks = () => ({
  level: (level: number) => levels.push(level),
  full: () => undefined,
  ended: () => ended++,
  trouble: (said: string) => trouble.push(said),
})

function result(...parts: [string, boolean][]) {
  return { results: parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } })) }
}

beforeEach(() => {
  box = document.createElement('div')
  field = document.createElement('textarea')
  box.append(field)
  document.body.append(box)
  Object.defineProperty(field, 'offsetParent', { get: () => box })
  field.focus()
  made = []
  levels = []
  ended = 0
  trouble = []
  phone = null
  class Recognition {
    continuous = false
    interimResults = false
    lang = ''
    onresult = null
    onend = null
    onerror = null
    onspeechstart = null
    onspeechend = null
    started = 0
    stopped = 0
    constructor() {
      made.push(this)
    }
    start() {
      this.started++
    }
    stop() {
      this.stopped++
      queueMicrotask(() => (this as unknown as Fake).onend?.())
    }
    abort = vi.fn()
  }
  Object.assign(globalThis, { webkitSpeechRecognition: Recognition })
})

afterEach(() => {
  box.remove()
  delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  delete (globalThis as { __ORDEN_SYSTEM__?: unknown }).__ORDEN_SYSTEM__
  delete (window as { __ordenHeard?: unknown }).__ordenHeard
  delete (window as { __ordenFrame?: unknown }).__ordenFrame
})

describe('the web’s recogniser', () => {
  test('listens on, with partial words, in the system’s language', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    expect(made[0]).toMatchObject({
      continuous: true,
      interimResults: true,
      lang: new Intl.DateTimeFormat().resolvedOptions().locale,
      started: 1,
    })
  })

  test('draws partial words as live and keeps the sentences it is sure of', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    made[0]!.onresult?.(result(['Hallo Welt.', true], [' wie geht', false]))
    expect(field.value).toBe('Hallo Welt. wie geht')
    expect(box.querySelector('[data-heard] mark')).not.toBeNull()
    made[0]!.onresult?.(result(['Hallo Welt.', true], [' wie geht es?', true]))
    expect(field.value).toBe('Hallo Welt. wie geht es?')
    expect(box.querySelector('[data-heard]')).toBeNull()
  })

  test('is started again when it ends itself, keeping what it heard', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    made[0]!.onresult?.(result(['Erster Satz.', true]))
    made[0]!.onend?.()
    expect(made[0]!.started).toBe(2)
    made[0]!.onresult?.(result(['Zweiter Satz.', true]))
    expect(field.value).toBe('Erster Satz. Zweiter Satz.')
  })

  test('finishes with its last words, as plain text', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    made[0]!.onresult?.(result(['Fast fertig', false]))
    await one.finish()
    expect(made[0]!.stopped).toBe(1)
    expect(field.value).toBe('Fast fertig')
    expect(box.querySelector('[data-heard]')).toBeNull()
  })

  test('puts the field back on Escape', async () => {
    field.value = 'Notiz'
    field.setSelectionRange(5, 5)
    const one = new DeviceSession(field, hooks())
    await one.open()
    made[0]!.onresult?.(result(['und mehr', false]))
    one.cancel()
    expect(field.value).toBe('Notiz')
  })

  test('says a microphone refused, and stops', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    made[0]!.onerror?.({ error: 'not-allowed' })
    expect(trouble).toEqual(['That microphone could not be opened.'])
    expect(ended).toBe(1)
  })

  test('shows that it hears a voice', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    made[0]!.onspeechstart?.()
    expect(levels.at(-1)).toBeGreaterThan(0)
  })
})

describe('Android’s recogniser', () => {
  beforeEach(() => {
    const held = { on: [] as boolean[], heard: null as ((json: string) => void) | null }
    phone = held
    Object.assign(globalThis, {
      __ORDEN_SYSTEM__: {
        askForTheFrame: () =>
          (window as { __ordenFrame?: (word: string) => void }).__ordenFrame?.('word'),
        listen: (_word: string, on: boolean) => {
          held.on.push(on)
          return on
        },
        dictates: () => true,
      },
    })
  })

  const said = (json: object) =>
    (window as { __ordenHeard?: (text: string) => void }).__ordenHeard?.(JSON.stringify(json))

  test('is turned on through the activity, with the page’s word', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    expect(phone?.on).toEqual([true])
    expect(made).toEqual([])
  })

  test('draws its partial words as live, keeps its sentences, and feeds the meter', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    said({ state: 'listening', partial: 'Kannst du' })
    expect(field.value).toBe('Kannst du')
    expect(box.querySelector('[data-heard] mark')).not.toBeNull()
    said({ state: 'listening', text: 'Kannst du mir helfen' })
    expect(field.value).toBe('Kannst du mir helfen')
    said({ level: 7 })
    expect(levels.at(-1)).toBeGreaterThan(0.5)
  })

  test('keeps what it heard when the phone stops listening by itself', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    said({ state: 'listening', partial: 'Hallo' })
    said({ state: 'off' })
    expect(field.value).toBe('Hallo')
    expect(ended).toBe(1)
  })

  test('is turned off when finished', async () => {
    const one = new DeviceSession(field, hooks())
    await one.open()
    await one.finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(phone?.on).toEqual([true, false])
  })
})
