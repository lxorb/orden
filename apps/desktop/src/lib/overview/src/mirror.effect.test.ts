import { afterEach, expect, test, vi } from 'vitest'

const { snapshotFrom } = await import('./mirror')

afterEach(() => {
  vi.restoreAllMocks()
})

test('a canvas in a window is pictured no larger than the overview draws it', () => {
  const encoded: [number, number][] = []
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: () => undefined }) as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    encoded.push([this.width, this.height])
    return 'data:image/webp;base64,AA'
  })

  const pane = document.createElement('div')
  const big = document.createElement('canvas')
  big.width = 2400
  big.height = 3200
  const small = document.createElement('canvas')
  small.width = 300
  small.height = 200
  pane.append(big, small)
  document.body.append(pane)

  const said = snapshotFrom(pane, new DOMRect(0, 0, 800, 600))()

  expect(encoded).toEqual([
    [384, 512],
    [300, 200],
  ])
  expect(said.html).toContain('width="2400"')
  expect(said.html).toContain('height="3200"')
  pane.remove()
})
