// @vitest-environment jsdom
import { expect, test } from 'vitest'

const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
Object.assign(SVGElement.prototype, {
  getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  getComputedTextLength: () => 10,
  createSVGMatrix: matrix,
  getScreenCTM: matrix,
})

const { drawDiagram } = await import('./diagrams')

const THEMED =
  '%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#ff0000"}}}%%\nflowchart TD\n  A[x] --> B[y]'

test('a published diagram from a note keeps the colours its init directive sets', async () => {
  const svg = await drawDiagram(THEMED, 'mermaid', 'light', 'page')
  expect(svg.toLowerCase()).toContain('#ff0000')
})

test('a published diagram from a note keeps the colours its front matter sets', async () => {
  const svg = await drawDiagram(
    '---\nconfig:\n  theme: base\n  themeVariables:\n    primaryColor: "#ff0000"\n---\nflowchart TD\n  A[x] --> B[y]',
    'mermaid',
    'light',
    'page',
  )
  expect(svg.toLowerCase()).toContain('#ff0000')
})
