import { describe, expect, it } from 'vitest'
import { inSight } from './sight'

const column = (count: number) =>
  Array.from({ length: count }, (_unused, at) => ({ y: at * 1140, height: 1100 }))

describe('the pages in sight', () => {
  it('are the few around the camera, not all of a thousand', () => {
    const shown = inSight(column(1000), { x: 0, y: 550, scale: 1 }, 800)

    expect(shown.from).toBe(0)
    expect(shown.to).toBeLessThanOrEqual(3)
  })

  it('follow the camera to the last page', () => {
    const pages = column(1000)
    const last = pages[999]!
    const shown = inSight(pages, { x: 0, y: last.y + last.height / 2, scale: 1 }, 800)

    expect(shown.to).toBe(1000)
    expect(shown.to - shown.from).toBeLessThanOrEqual(3)
  })

  it('reach further out when the camera is zoomed out', () => {
    const near = inSight(column(1000), { x: 0, y: 50_000, scale: 1 }, 800)
    const far = inSight(column(1000), { x: 0, y: 50_000, scale: 0.1 }, 800)

    expect(far.to - far.from).toBeGreaterThan(near.to - near.from)
  })

  it('hold the pages a screen beyond the edge, so they are drawn before they are reached', () => {
    const shown = inSight(column(1000), { x: 0, y: 550, scale: 1 }, 800, 800)
    const bare = inSight(column(1000), { x: 0, y: 550, scale: 1 }, 800, 0)

    expect(shown.to).toBeGreaterThan(bare.to)
  })

  it('are none when the camera is far from every page', () => {
    expect(inSight(column(3), { x: 0, y: -100_000, scale: 1 }, 800)).toEqual({ from: 0, to: 0 })
  })
})
