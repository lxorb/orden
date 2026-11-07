import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const asked = vi.hoisted(() => ({
  open: true,
  ready: true,
  question: '',
  turns: [],
  running: false,
  trouble: null,
  context: null,
  texts: [] as { id: string; label: string }[],
  close: () => undefined,
  ask: () => undefined,
  stop: () => undefined,
  drop: () => undefined,
  take: vi.fn(),
  refuse: vi.fn(),
  dropText: () => undefined,
}))

vi.mock('./ai/quick.svelte', () => ({ quick: asked }))

const QuickAdd = (await import('./quick-add/QuickAdd.svelte')).default
const QuickQuestion = (await import('./QuickQuestion.svelte')).default

let target: HTMLElement
let drawn: ReturnType<typeof mount> | undefined

const LONG = 'The heron stands still in the shallows. '.repeat(3_000)

function pasted(field: HTMLElement, text: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [], getData: (kind: string) => (kind === 'text/plain' ? text : '') },
  })
  field.dispatchEvent(event)
  flushSync()
  return event
}

function quickAdd(props: Record<string, unknown> = {}) {
  drawn = mount(QuickAdd, {
    target,
    props: {
      langs: ['en'],
      notes: [],
      tags: [],
      onsubmit: () => true,
      onclose: () => undefined,
      ...props,
    },
  })
  flushSync()
  const field = target.querySelector('input.field')
  if (!(field instanceof HTMLInputElement)) throw new Error('no field')
  return field
}

const description = () => target.querySelector<HTMLTextAreaElement>('textarea.words')

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  asked.take.mockClear()
  asked.refuse.mockClear()
})

afterEach(() => {
  if (drawn) void unmount(drawn)
  drawn = undefined
  target.remove()
})

describe('a very long paste', () => {
  test('into the quick question comes in as text beside the field', () => {
    drawn = mount(QuickQuestion, { target, props: {} })
    flushSync()
    const field = target.querySelector('textarea')
    if (!field) throw new Error('no field')

    expect(pasted(field, LONG).defaultPrevented).toBe(true)
    expect(asked.take).toHaveBeenCalledWith('Text', LONG)
    expect(pasted(field, 'a short line').defaultPrevented).toBe(false)
    expect(asked.take).toHaveBeenCalledTimes(1)

    pasted(field, 'x'.repeat(2_000_001))
    expect(asked.take).toHaveBeenCalledTimes(1)
    expect(asked.refuse).toHaveBeenCalledOnce()
  })

  test('into the quick add line goes to the description, not the line', () => {
    const field = quickAdd()

    expect(pasted(field, LONG).defaultPrevented).toBe(true)
    expect(field.value).toBe('')
    expect(description()?.value).toBe(LONG)

    pasted(field, LONG)
    expect(description()?.value).toBe(`${LONG}\n\n${LONG}`)
    expect(pasted(field, 'Call mum tomorrow').defaultPrevented).toBe(false)
  })

  test('of many lines still offers one task a line', () => {
    const field = quickAdd()

    expect(pasted(field, `${LONG}\none more`).defaultPrevented).toBe(true)
    expect(description()).toBeNull()
    expect(target.querySelector('.pasted')).not.toBeNull()
  })

  test('of many lines while editing goes to the description too', () => {
    const field = quickAdd({ mode: 'edit', prefill: { text: 'Call mum' } })

    expect(pasted(field, `${LONG}\none more`).defaultPrevented).toBe(true)
    expect(field.value).toBe('Call mum')
    expect(description()?.value).toBe(`${LONG}\none more`)
  })
})
