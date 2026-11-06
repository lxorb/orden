import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import Doorway from './Doorway.svelte'

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

async function settle() {
  for (let round = 0; round < 5; round++) await new Promise((done) => setTimeout(done, 0))
}

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

  expect(host.querySelector('.list')).not.toBeNull()
  const leaving = of('.list').slice(1)
  expect(leaving).toHaveLength(1)
  const going = opacities(leaving[0]!)
  expect(going.at(0)).toBe(1)
  expect(going.at(-1)).toBe(0)
  expect(going.every((one, at) => at === 0 || one <= going[at - 1]!)).toBe(true)

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
  expect(back.at(0)).toBeGreaterThan(0)
  expect(back.at(0)).toBeLessThan(1)
  expect(Math.abs(back.at(0)! - shown)).toBeLessThan(0.25)
  expect(back.at(-1)).toBe(0)
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
  expect(host.querySelectorAll('.list')).toHaveLength(1)
  await gone()
})
