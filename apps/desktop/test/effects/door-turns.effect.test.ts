import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Doorway from './Doorway.svelte'

/** A popup fetched through a door plays its way out, and a press in the middle of
 *  either way turns it round where it is (#1067).
 *
 *  The list of spaces under the panel's header came in and, on the second tap, simply
 *  vanished: the `{#if}` it was drawn under took the `{#await}` that fetched it down at
 *  once, and a transition only plays for the block nearest it. See Door.svelte, and
 *  doors-play-out.test.ts for the rule read out of every component.
 *
 *  Played here with an animation that runs until the test says how far it has got, so
 *  what is read is what a reader would see on each frame: where each movement starts,
 *  and which way it goes. */

interface Played {
  node: Element
  frames: Keyframe[]
  duration: number
  currentTime: number
  playState: string
  onfinish: (() => void) | null
  cancel: () => void
}

let played: Played[] = []

beforeEach(() => {
  played = []
  vi.spyOn(Element.prototype, 'animate').mockImplementation(function (
    this: Element,
    frames,
    options,
  ) {
    const duration = typeof options === 'object' ? Number(options.duration ?? 0) : 0
    const one: Played = {
      node: this,
      frames: (frames ?? []) as Keyframe[],
      duration,
      currentTime: 0,
      playState: 'running',
      onfinish: null,
      cancel: () => {
        one.playState = 'idle'
      },
    }
    // The wait before a movement is none here; it ends a task later.
    if (!duration) setTimeout(() => one.playState === 'running' && finish(one), 0)
    else played.push(one)
    return one as unknown as Animation
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function finish(one: Played) {
  one.playState = 'finished'
  one.onfinish?.()
}

/** Until every movement asked for has started: a few tasks, since each waits for the
 *  one before it to have measured. */
async function settle() {
  for (let round = 0; round < 5; round++) await new Promise((done) => setTimeout(done, 0))
}

/** The movements of one element, in the order they started. */
const of = (selector: string) => played.filter((one) => one.node.matches(selector))
const opacities = (one: Played) => one.frames.map((frame) => Number(frame.opacity))

function mounted() {
  const host = document.body.appendChild(document.createElement('div'))
  const fetched = vi.fn()
  const door = mount(Doorway, { target: host, props: { fetched } }) as unknown as {
    show: (on: boolean) => void
  }
  return { host, fetched, door, gone: () => unmount(door) }
}

test('fetches nothing before it is first open', async () => {
  const { host, fetched, gone } = mounted()
  flushSync()
  await settle()

  expect(fetched).not.toHaveBeenCalled()
  expect(host.querySelector('.list')).toBeNull()
  await gone()
})

test('plays its way out once, from where it stood, and is gone when that ends', async () => {
  const { host, door, gone } = mounted()
  door.show(true)
  flushSync()
  await settle()
  const [coming] = of('.list')
  expect(opacities(coming!).at(0)).toBe(0)
  expect(opacities(coming!).at(-1)).toBe(1)
  finish(coming!)

  door.show(false)
  flushSync()
  await settle()

  // Still on the page while it leaves - the way out has something to play.
  expect(host.querySelector('.list')).not.toBeNull()
  const leaving = of('.list').slice(1)
  expect(leaving).toHaveLength(1)
  const going = opacities(leaving[0]!)
  expect(going.at(0)).toBe(1)
  expect(going.at(-1)).toBe(0)
  // Down all the way, never back up.
  expect(going.every((one, at) => at === 0 || one <= going[at - 1]!)).toBe(true)

  // And the catch lets presses through while it does.
  const [catchGoing] = of('.catch')
  expect(catchGoing?.frames.every((frame) => frame.pointerEvents === 'none')).toBe(true)

  finish(leaving[0]!)
  finish(catchGoing!)
  await settle()
  expect(host.querySelector('.list')).toBeNull()
  await gone()
})

test('pressed again on its way in, turns round where it is rather than from its end', async () => {
  const { door, gone } = mounted()
  door.show(true)
  flushSync()
  await settle()
  const [coming] = of('.list')
  coming!.currentTime = coming!.duration / 2
  const shown = opacities(coming!)[Math.floor(coming!.frames.length / 2)]!

  door.show(false)
  flushSync()
  await settle()

  const [, turning] = of('.list')
  const back = opacities(turning!)
  // From where it had got to, not from all the way in: no step back to the end.
  expect(back.at(0)).toBeGreaterThan(0)
  expect(back.at(0)).toBeLessThan(1)
  expect(Math.abs(back.at(0)! - shown)).toBeLessThan(0.25)
  expect(back.at(-1)).toBe(0)
  // And shorter, by as much as it had still to come.
  expect(turning!.duration).toBeLessThan(coming!.duration)
  await gone()
})

test('and pressed again on its way out, comes back from where it is', async () => {
  const { host, door, gone } = mounted()
  door.show(true)
  flushSync()
  await settle()
  finish(of('.list')[0]!)

  door.show(false)
  flushSync()
  await settle()
  const going = of('.list')[1]!
  going.currentTime = going.duration / 2

  door.show(true)
  flushSync()
  await settle()

  const again = of('.list')[2]!
  const up = opacities(again)
  expect(up.at(0)).toBeGreaterThan(0)
  expect(up.at(0)).toBeLessThan(1)
  expect(up.at(-1)).toBe(1)
  // The same element, never a second list beside the one that was leaving.
  expect(host.querySelectorAll('.list')).toHaveLength(1)
  await gone()
})
