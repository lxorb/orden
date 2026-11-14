import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let still = false
vi.mock('../platform/src/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/motion')>()),
  stillness: () => still,
  dur: (ms: number) => (still ? 0 : ms),
}))

const { said } = await import('../said.svelte')
const { started, stopFlights } = await import('./flight')

interface Played {
  node: Element
  frames: Keyframe[]
  options: KeyframeAnimationOptions
  animation: Animation
}

let played: Played[] = []

function box(node: Element, x: number, y: number, width: number, height: number) {
  node.getBoundingClientRect = () => ({ x, y, width, height }) as DOMRect
}

beforeEach(() => {
  still = false
  played = []
  vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => {
    queueMicrotask(() => run(0))
    return 0
  })
  Element.prototype.animate = function animate(
    frames: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions,
  ) {
    const animation = {
      onfinish: null as (() => void) | null,
      oncancel: null as (() => void) | null,
      finish() {
        this.onfinish?.()
      },
      cancel() {
        this.oncancel?.()
      },
    }
    played.push({
      node: this,
      frames: frames as Keyframe[],
      options: options as KeyframeAnimationOptions,
      animation: animation as unknown as Animation,
    })
    return animation as unknown as Animation
  }

  document.body.innerHTML = `
    <div data-panes>
      <div data-pane="left"><div class="webbar"><button data-opens="downloads" data-tab="a"></button></div></div>
      <div data-pane="right"><div class="webbar"><button data-opens="downloads" data-tab="b"></button></div></div>
    </div>
    <button id="export">Export</button>`
  const panes = document.querySelector('[data-panes]')!
  box(panes, 0, 0, 1000, 600)
  const [left, right] = document.querySelectorAll('[data-pane]')
  box(left!, 0, 0, 500, 600)
  box(right!, 500, 0, 500, 600)
  const bars = document.querySelectorAll('.webbar')
  box(bars[0]!, 0, 0, 500, 36)
  box(bars[1]!, 500, 0, 500, 36)
  box(glyph('a'), 460, 4, 28, 28)
  box(glyph('b'), 960, 4, 28, 28)
  box(document.getElementById('export') as Element, 100, 300, 80, 24)
})

afterEach(() => {
  stopFlights()
  vi.unstubAllGlobals()
})

function glyph(tab: string): Element {
  return document.querySelector(`[data-tab="${tab}"]`)!
}

const flights = () => played.filter((one) => one.node.parentElement === document.body)
const answers = (node: Element) => played.filter((one) => one.node === node)

test("a page's file flies from its page to its own bar's glyph, which answers", async () => {
  await started('slides.pdf', { tab: 'b' })

  const [flight] = flights()
  expect(flight).toBeDefined()
  const card = flight?.node as HTMLElement
  expect(card.style.left).toBe(`${String(750 - 14)}px`)
  expect(card.style.top).toBe(`${String(36 - 14)}px`)
  expect(card.className).toBe('')
  expect(card.style.pointerEvents).toBe('none')
  const last = flight?.frames.at(-1)?.transform
  expect(last).toContain(`translate(${String(974 - 750)}px, ${String(18 - 36)}px)`)

  flight?.animation.finish()
  expect(card.isConnected).toBe(false)
  expect(answers(glyph('b'))).toHaveLength(1)
  expect(answers(glyph('a'))).toHaveLength(0)
})

test('is said, for whoever is listening', async () => {
  await started('slides.pdf', { tab: 'a' })
  expect(said.words).toBe('Downloading slides.pdf')
})

test('an export flies from the control it was asked for by', async () => {
  const button = document.getElementById('export')
  await started('Trip.pdf', { element: button })

  const card = flights()[0]?.node as HTMLElement
  expect(card.style.left).toBe(`${String(140 - 14)}px`)
  expect(card.style.top).toBe(`${String(312 - 14)}px`)
})

test('with no glyph on screen, it goes to the corner and fades there', async () => {
  for (const one of document.querySelectorAll('[data-opens="downloads"]')) one.remove()
  await started('Trip.pdf', {})

  const [flight] = flights()
  expect(flight).toBeDefined()
  expect(flight?.frames.at(-1)?.opacity).toBe('0')
})

test('a burst is a handful of flights, one after another, and the glyph answers each', async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, index) => started(`${String(index)}.pdf`, { tab: 'a' })),
  )

  const going = flights()
  expect(going).toHaveLength(5)
  const delays = going.map((one) => one.options.delay)
  expect(new Set(delays).size).toBe(5)
  expect(answers(glyph('a'))).toHaveLength(3)
})

test('the window changing size ends every flight in the air', async () => {
  await started('one.pdf', { tab: 'a' })
  await started('two.pdf', { tab: 'b' })
  const cards = flights().map((one) => one.node)

  window.dispatchEvent(new Event('resize'))
  expect(cards.every((one) => !one.isConnected)).toBe(true)
})

test('a reader who asked for less movement sees no flight, only the glyph answering', async () => {
  still = true
  await started('slides.pdf', { tab: 'a' })

  expect(flights()).toHaveLength(0)
  const [answer] = answers(glyph('a'))
  expect(answer).toBeDefined()
  expect(answer?.frames.every((one) => !('transform' in one))).toBe(true)
  expect(answer?.options.duration).toBeGreaterThan(0)
})
