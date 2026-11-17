import { expect, test, vi } from 'vitest'

function nothing(): undefined {
  return undefined
}

class Lines {
  moveTo = nothing
  lineTo = nothing
  arc = nothing
  rect = nothing
  closePath = nothing
}

function drawsNothing(): CanvasRenderingContext2D {
  return new Proxy<Record<string | symbol, unknown>>(
    {},
    {
      get: (held, name) => (name in held ? held[name] : nothing),
      set: (held, name, value) => {
        held[name] = value
        return true
      },
    },
  ) as unknown as CanvasRenderingContext2D
}

function square(side: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: side,
    height: side,
    right: side,
    bottom: side,
  } as DOMRect
}

function pointer(type: string, at: number): PointerEvent {
  return new MouseEvent(type, { bubbles: true, clientX: at, clientY: at }) as PointerEvent
}

test('a tap on a note in a published page graph opens it, as a click does', async () => {
  vi.stubGlobal('Path2D', Lines)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  HTMLCanvasElement.prototype.getContext = drawsNothing as never
  HTMLElement.prototype.getBoundingClientRect = () => square(300)

  document.body.innerHTML =
    '<div class="graph" data-here="/x"><script type="application/json">' +
    JSON.stringify({ nodes: [{ id: '/b', name: 'b.md', path: '#opened', degree: 0 }], edges: [] }) +
    '</script></div>'

  await import('./site')

  const canvas = document.querySelector('.graph canvas')
  if (!canvas) throw new Error('no graph was drawn')

  for (const type of ['pointerdown', 'pointerup', 'pointerout', 'pointerleave', 'click']) {
    canvas.dispatchEvent(pointer(type, 150))
  }

  expect(window.location.hash).toBe('#opened')
})

function touch(type: string): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerType', { value: 'touch' })
  return event
}

test("a note's card, opened by a long press on its link, stays once the finger lifts, until a tap elsewhere", async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(hover: none)' }))
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response('<main id="write"><h1>Page B</h1><p>Words of b.</p></main>')),
  )
  vi.useFakeTimers()
  try {
    await import('./site')
    const link = document.createElement('a')
    link.href = '/b'
    link.textContent = 'to b'
    document.body.append(link)
    const card = document.querySelector<HTMLElement>('body > .card')
    if (!card) throw new Error('no card was made')

    link.dispatchEvent(touch('pointerover'))
    link.dispatchEvent(touch('pointerdown'))
    link.dispatchEvent(touch('contextmenu'))
    await vi.advanceTimersByTimeAsync(400)
    link.dispatchEvent(touch('pointerup'))
    link.dispatchEvent(touch('pointerout'))
    await vi.advanceTimersByTimeAsync(1000)

    expect(card.hidden).toBe(false)
    expect(card.textContent).toContain('Words of b.')

    document.body.dispatchEvent(touch('pointerdown'))
    expect(card.hidden).toBe(true)
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
