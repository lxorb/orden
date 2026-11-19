// @vitest-environment jsdom
import { expect, test } from 'vitest'

const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
Object.assign(SVGElement.prototype, {
  getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  getComputedTextLength: () => 10,
  createSVGMatrix: matrix,
  getScreenCTM: matrix,
})

const { drawDiagram } = await import('../../fences/src/diagrams')
const { mermaidSvg } = await import('@orden/editor')
const { asFile } = await import('./site-diagrams')

const FENCE = 'flowchart TD\n  A[Start here] --> B[Finish line]'

function wordsIn(file: string): string {
  return (file.match(/<tspan[^>]*>[^<]+<\/tspan>/g) ?? []).map((one) => one.replace(/<[^>]*>/g, '')).join('')
}

test('a published diagram drawn on its own keeps its words', async () => {
  const file = asFile(await drawDiagram(FENCE, 'mermaid', 'light', 'page')) ?? ''
  expect(wordsIn(file)).toContain('Start here')
})

test('a published diagram drawn while the editor draws a diagram keeps its words', async () => {
  const [page] = await Promise.all([
    drawDiagram(FENCE, 'mermaid', 'light', 'page'),
    mermaidSvg('orden-diagram-editor', 'flowchart TD\n  X[In the editor]', {
      htmlLabels: true,
      dompurifyConfig: {},
    }),
  ])
  const file = asFile(page) ?? ''
  expect(wordsIn(file)).toContain('Start here')
})

test('a published diagram drawn while an answer draws a diagram keeps its words', async () => {
  const [page] = await Promise.all([
    drawDiagram(FENCE, 'mermaid', 'light', 'page'),
    drawDiagram('flowchart TD\n  X[In an answer]', 'mermaid', 'light', 'document', false),
  ])
  const file = asFile(page) ?? ''
  expect(wordsIn(file)).toContain('Start here')
})
