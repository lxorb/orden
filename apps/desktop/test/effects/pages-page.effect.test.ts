import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PageNode } from '@orden/markdown/canvas'

interface Asked {
  density: number
  settle: (drawn: { image: ImageBitmap; width: number; height: number } | null) => void
}

const asked: Asked[] = []
const words = vi.fn(() => Promise.resolve(null))
const closeUps = vi.fn(() => Promise.resolve(null))

vi.mock('../../src/lib/pdf/src/api', async (original) => ({
  ...(await original<typeof import('../../src/lib/pdf/src/api')>()),
  paperOf: (_at: unknown, _number: number, _signal: unknown, _aside: boolean, density: number) =>
    new Promise((settle) => asked.push({ density, settle })),
  wordsInto: words,
  closeUpOf: closeUps,
  viewOf: () => Promise.resolve(null),
}))

const PagesPageHost = (await import('./PagesPageHost.svelte')).default

function bitmap(width: number, height: number): ImageBitmap {
  const image = { width, height, close: () => Object.assign(image, { width: 0, height: 0 }) }
  return image
}

const sheet = (over: Partial<PageNode> = {}): PageNode => ({
  id: 'p1',
  type: 'page',
  paper: 'a4',
  pattern: 'blank',
  x: 0,
  y: 0,
  width: 794,
  height: 1123,
  file: 'Heavy.pdf',
  page: 1,
  ...over,
})

let target: HTMLElement
let shown: { edit: (page: PageNode) => void; zoom: (unit: number) => void } | undefined

async function settled() {
  for (let round = 0; round < 4; round++) await Promise.resolve()
  flushSync()
}

beforeEach(() => {
  asked.length = 0
  words.mockClear()
  closeUps.mockClear()
  target = document.createElement('div')
  document.body.append(target)
  shown = mount(PagesPageHost, { target, props: { first: sheet() } })
  flushSync()
})

afterEach(() => {
  if (shown) void unmount(shown)
  target.remove()
})

const canvas = () => target.querySelector<HTMLCanvasElement>('.sheet canvas:not(.close)')

describe('a page note page over a PDF', () => {
  test('an edit that hands the page in again as a new object keeps its canvas and asks for nothing', async () => {
    asked[0]?.settle({ image: bitmap(1588, 2246), width: 794, height: 1123 })
    await settled()
    const before = canvas()
    expect(before?.classList.contains('there')).toBe(true)
    expect(before?.width).toBe(1588)
    await new Promise((done) => setTimeout(done, 300))
    const laidOut = words.mock.calls.length

    shown?.edit(sheet())
    flushSync()
    shown?.edit(sheet({ color: '2' }))
    await settled()

    expect(canvas()).toBe(before)
    expect(canvas()?.width).toBe(1588)
    expect(canvas()?.classList.contains('there')).toBe(true)
    expect(asked).toHaveLength(1)
    await new Promise((done) => setTimeout(done, 300))
    expect(words.mock.calls.length).toBe(laidOut)
  })

  test('zoomed, the paper drawn before stays on screen until the sharper one is ready', async () => {
    asked[0]?.settle({ image: bitmap(1588, 2246), width: 794, height: 1123 })
    await settled()

    shown?.zoom(0.2)
    flushSync()
    expect(asked).toHaveLength(2)
    expect(canvas()?.width).toBe(1588)
    expect(canvas()?.classList.contains('there')).toBe(true)

    asked[1]?.settle({ image: bitmap(3176, 4492), width: 794, height: 1123 })
    await settled()
    expect(canvas()?.width).toBe(3176)
  })

  test('a paper let go of by the cache never blanks the page', async () => {
    const first = bitmap(1588, 2246)
    asked[0]?.settle({ image: first, width: 794, height: 1123 })
    await settled()

    shown?.zoom(0.2)
    flushSync()
    first.close()
    asked[1]?.settle({ image: bitmap(0, 0), width: 794, height: 1123 })
    await settled()

    expect(canvas()?.width).toBe(1588)
    expect(canvas()?.classList.contains('there')).toBe(true)
  })
})
