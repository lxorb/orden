import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Hint from './Hint.svelte'

const SENTENCE = 'Turns straight quotes into curly ones.'

let target: HTMLElement
let close: () => void

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Hint, { target, props: { text: SENTENCE } })
  close = () => void unmount(shown)
  flushSync()
})

afterEach(() => {
  close()
  target.remove()
})

const button = () => target.querySelector('button')!
async function settled() {
  for (let round = 0; round < 5; round++) {
    await new Promise((done) => setTimeout(done, 0))
    flushSync()
  }
}

const said = () => document.querySelector('.orden-bubble')?.textContent ?? null

function pointer(type: string, pointerType: string) {
  const bubbles = type !== 'pointerenter' && type !== 'pointerleave'
  button().dispatchEvent(new PointerEvent(type, { bubbles, cancelable: true, pointerType }))
  flushSync()
}

function tap(pointerType: string) {
  pointer('pointerover', pointerType)
  pointer('pointerenter', pointerType)
  pointer('pointerdown', pointerType)
  pointer('pointerup', pointerType)
  button().focus()
  flushSync()
  button().click()
  flushSync()
}

test.each(['touch', 'pen'])(
  'a %s tap shows the sentence, and a second tap puts it away',
  async (kind) => {
    tap(kind)
    await settled()
    expect(said()).toBe(SENTENCE)
    tap(kind)
    await vi.waitFor(() => expect(said()).toBeNull())
  },
)

test('a mouse shows the sentence while it rests on the ?', async () => {
  pointer('pointerenter', 'mouse')
  await settled()
  expect(said()).toBe(SENTENCE)
  pointer('pointerleave', 'mouse')
  await vi.waitFor(() => expect(said()).toBeNull())
})

test('the keyboard shows the sentence on reaching the ?', async () => {
  button().focus()
  await settled()
  expect(said()).toBe(SENTENCE)
  button().blur()
  await vi.waitFor(() => expect(said()).toBeNull())
})
