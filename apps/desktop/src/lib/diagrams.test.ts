// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'

/** flowchart.js lays its boxes out by measuring the words in them, which jsdom
 *  does not do; every word measures nothing, which is all a test of what ends
 *  up in the drawing needs. */
const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
Object.assign(SVGElement.prototype, {
  getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  createSVGMatrix: matrix,
  getScreenCTM: matrix,
})

const { flowSource } = await import('@nib/editor')
const { drawDiagram } = await import('./diagrams')

/** A ` ```flow ` fence is the note's words like any other, and whoever wrote the
 *  note decides what the drawing points at. flowchart.js will make a box a link
 *  to whatever follows `:>`, and a press on one call whatever window global
 *  follows `:$` - neither through anything that asks whether the note is trusted,
 *  so neither may come out of the drawing. */
describe('a flowchart a note drew', () => {
  test('points nowhere a link in a note may not point', async () => {
    const svg = await drawDiagram(
      'st=>start: Start:>javascript:alert(1)\ne=>end: End:>https://example.com/ok\nst->e',
      'flow',
      'light',
    )

    expect(svg).toContain('<svg')
    expect(svg).not.toContain('javascript:')
    expect(svg).toContain('https://example.com/ok')
  })

  /** The live preview draws into the page itself rather than into a string, so
   *  the handler flowchart.js puts on a box is still on it there. Drawn the way
   *  the live preview draws, with the source it hands over and without. */
  test('calls nothing when one of its boxes is pressed', async () => {
    const flowchart = (await import('flowchart.js')).default
    const called = vi.fn()
    Object.assign(window, { pressed: called })

    const press = (code: string) => {
      const host = document.createElement('div')
      document.body.append(host)
      try {
        flowchart.parse(code).drawSVG(host)
        for (const node of host.querySelectorAll('*')) {
          node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }
      } finally {
        host.remove()
      }
    }

    const code = 'st=>start: Start:$pressed\ne=>end: End\nst->e'

    // What the hook would do, so that the line after it says something.
    press(code)
    expect(called).toHaveBeenCalled()

    called.mockClear()
    press(flowSource(code))
    expect(called).not.toHaveBeenCalled()
  })
})
