// @vitest-environment jsdom
import { describe, expect, test, vi } from 'vitest'

const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
Object.assign(SVGElement.prototype, {
  getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  createSVGMatrix: matrix,
  getScreenCTM: matrix,
})

const { flowSource } = await import('@orden/editor/flow')
const { drawDiagram } = await import('./diagrams')

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

    press(code)
    expect(called).toHaveBeenCalled()

    called.mockClear()
    press(flowSource(code))
    expect(called).not.toHaveBeenCalled()
  })
})
