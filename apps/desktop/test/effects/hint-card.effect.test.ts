import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import HintCard from '../../src/lib/HintCard.svelte'
import { hints } from '../../src/lib/hints.svelte'

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

let host: HTMLElement
let shown: ReturnType<typeof mount> | undefined

beforeEach(() => {
  localStorage.clear()
  hints.restore()
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  host.remove()
  for (const one of document.querySelectorAll('.nib-bubble')) one.remove()
})

function card(): HTMLElement | null {
  return document.querySelector('.nib-bubble.hint')
}

test('a card drawn once the session has settled stays up', () => {
  hints.settle()
  shown = mount(HintCard, { target: host, props: { hint: 'graph', text: 'See them' } })
  flushSync()

  expect(hints.current).toBe('graph')
  expect(card()?.textContent).toContain('See them')
})

test('a card already drawn goes up when the session settles, and stays', () => {
  shown = mount(HintCard, { target: host, props: { hint: 'palette', text: 'Press it' } })
  flushSync()
  expect(card()).toBeNull()

  hints.settle()
  flushSync()

  expect(hints.current).toBe('palette')
  expect(card()?.textContent).toContain('Press it')
})

test('its cross puts it away', () => {
  hints.settle()
  shown = mount(HintCard, { target: host, props: { hint: 'graph', text: 'See them' } })
  flushSync()

  card()?.querySelector<HTMLButtonElement>('.shut')?.click()
  flushSync()

  expect(hints.current).toBeNull()
  expect(hints.seen).toEqual(['graph'])
})
