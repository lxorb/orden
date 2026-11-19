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

const answer = (code: string) => drawDiagram(code, 'mermaid', 'light', 'document', false)

test('an answer sequence diagram that sends a URL in brackets still draws', async () => {
  const code = 'sequenceDiagram\n  Client->>API: Send long URL (POST /shorten)\n  API-->>Client: short code'
  expect(await answer(code)).toContain('<svg')
})

test('an answer flowchart with a short URL step in brackets still draws', async () => {
  expect(await answer('flowchart LR\n  A[Client] --> B["Create short URL (base62)"]')).toContain('<svg')
})

test('an answer flowchart naming a Windows folder still draws', async () => {
  expect(await answer('flowchart LR\n  A["C:\\Data\\input.csv"] --> B[Load]')).toContain('<svg')
})
