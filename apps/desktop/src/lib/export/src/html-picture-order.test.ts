import { describe, expect, test } from 'vitest'
import { type Block, documentOf } from './document'

function shown(blocks: readonly Block[]): string[] {
  return blocks
    .flatMap((block) =>
      'spans' in block
        ? block.spans.map((span) => (span.picture === undefined ? span.text.trim() : `<${span.picture}>`))
        : [],
    )
    .filter((one) => one !== '')
}
describe('resized pictures with their captions right under them, in Word and RTF exports', () => {
  test('each caption stays under its own picture, as the reading view draws them', () => {
    const note =
      '<img src="step-1.png" alt="" style="zoom:50%;" />\nOpen the lid\n<img src="step-2.png" alt="" style="zoom:50%;" />\nPour the water\n'
    expect(shown(documentOf(note, 'Note').blocks)).toEqual([
      '<step-1.png>',
      'Open the lid',
      '<step-2.png>',
      'Pour the water',
    ])
  })
  test('words written before a picture in an HTML block stay before it', () => {
    const note = '<div align="center">\n<p>Before the chart</p>\n<img src="chart.png" alt="" width="300" />\n</div>\n'
    expect(shown(documentOf(note, 'Note').blocks)).toEqual(['Before the chart', '<chart.png>'])
  })
})
test('a picture whose alt text holds a > before its address is still exported', () => {
  const note = '<div>\n<img alt="Before > after" src="chart.png" />\n</div>\n'
  expect(shown(documentOf(note, 'Note').blocks)).toEqual(['<chart.png>'])
})
