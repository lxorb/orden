import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const world = vi.hoisted((): { provider: object | null } => ({
  provider: { id: 'p', kind: 'openai', name: 'OpenAI', model: '' },
}))

vi.mock('../../src/lib/ai-providers/src/api', () => ({ transcriberNow: () => world.provider }))
vi.mock('../../src/lib/ai/quick.svelte', () => ({
  quick: {
    open: true,
    ready: true,
    question: '',
    turns: [],
    running: false,
    trouble: null,
    context: { kind: 'note', name: 'Quarterly plan' },
    texts: [],
    close: () => undefined,
    ask: () => undefined,
    stop: () => undefined,
    drop: () => undefined,
  },
}))

const { engines, voice } = await import('../../src/lib/dictation/src/api')
const QuickAdd = (await import('../../src/lib/quick-add/src/QuickAdd.svelte')).default
const QuickQuestion = (await import('../../src/lib/QuickQuestion.svelte')).default

let target: HTMLElement
let drawn: ReturnType<typeof mount> | undefined

function drawQuestion() {
  drawn = mount(QuickQuestion, { target, props: {} })
  flushSync()
}

function draw(props: Record<string, unknown> = {}) {
  drawn = mount(QuickAdd, {
    target,
    props: {
      langs: ['en'],
      tags: ['errand'],
      onsubmit: () => true,
      onclose: () => undefined,
      ...props,
    },
  })
  flushSync()
}

const settle = async () => {
  for (let one = 0; one < 3; one++) await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  world.provider = { id: 'p', kind: 'openai', name: 'OpenAI', model: '' }
  engines.choose(null)
})

afterEach(() => {
  voice.asking = null
  if (drawn) void unmount(drawn)
  drawn = undefined
  target.remove()
})

describe('quick add', () => {
  test('draws the microphone where there is a road to take', () => {
    draw()
    expect(target.querySelector('button.mic')).not.toBeNull()
  })

  test('and none where there is none', () => {
    world.provider = null
    draw()
    expect(target.querySelector('button.mic')).toBeNull()
  })

  test('and none in the window over other apps', () => {
    draw({ dictates: false })
    expect(target.querySelector('button.mic')).toBeNull()
  })

  test('reads the dictation key in its line, for its line', async () => {
    draw()
    const line = target.querySelector<HTMLInputElement>('input.field')!
    line.focus()
    line.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await settle()
    expect(voice.asking?.field()).toBe(line)
    expect(voice.asking?.words?.()).toEqual(expect.arrayContaining(['errand']))
  })

  test('and in its description, once that is where the typing is', async () => {
    draw({ prefill: { description: '' } })
    const words = target.querySelector<HTMLTextAreaElement>('textarea.words')!
    words.focus()
    words.dispatchEvent(new FocusEvent('focus'))
    words.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await settle()
    expect(voice.asking?.field()).toBe(words)
  })
})

describe('the quick question', () => {
  test('draws the microphone beside its round button, for its field', async () => {
    drawQuestion()
    expect(target.querySelector('.field button.mic')).not.toBeNull()
    const field = target.querySelector<HTMLTextAreaElement>('.field textarea')!
    field.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await settle()
    expect(voice.asking?.field()).toBe(field)
    expect(voice.asking?.words?.()).toEqual(['Quarterly plan'])
  })
})
