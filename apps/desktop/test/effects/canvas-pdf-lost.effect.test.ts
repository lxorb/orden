import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ readable: false, asked: [] as number[] }))

vi.mock('../../src/lib/pages/paper', async (actual) => {
  const real = await actual<typeof import('../../src/lib/pages/paper')>()
  return {
    ...real,
    holdPaper: () => () => undefined,
    paperEdition: () => 0,
    paperOf: (_at: unknown, number: number) => {
      world.asked.push(number)
      return Promise.resolve(
        world.readable
          ? { width: 600, height: 800, image: { width: 60, height: 80, close: () => undefined } }
          : null,
      )
    },
  }
})

const CanvasPdf = (await import('../../src/lib/CanvasPdf.svelte')).default

let close: (() => void) | undefined

afterEach(() => {
  close?.()
  close = undefined
  document.body.replaceChildren()
  world.readable = false
  world.asked = []
  vi.useRealTimers()
})

function shown(page?: number) {
  const target = document.body.appendChild(document.createElement('div'))
  const card = mount(CanvasPdf, {
    target,
    props: {
      file: 'Gone.pdf',
      note: '/space/Board.canvas',
      root: '/space',
      ...(page === undefined ? {} : { page }),
    },
  })
  close = () => void unmount(card, { outro: false })
  return target
}

const settled = async () => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
  flushSync()
}

test('a PDF card whose paper cannot be read says so, and shows the page once it can', async () => {
  vi.useFakeTimers()
  const target = shown()
  await settled()

  expect(target.querySelector('.missing')?.textContent).toBe('The paper could not be read')

  world.readable = true
  vi.advanceTimersByTime(5000)
  flushSync()
  await settled()

  expect(target.querySelector('.missing')).toBeNull()
})

test('a PDF card that names a page draws that page', async () => {
  world.readable = true
  shown(3)
  await settled()

  expect(world.asked).toContain(3)
  expect(world.asked).not.toContain(1)
})
