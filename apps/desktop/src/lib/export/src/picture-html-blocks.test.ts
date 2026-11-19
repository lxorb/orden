import { describe, expect, test } from 'vitest'
import { documentOf, picturesIn } from './document'

const pictures = (source: string) => picturesIn(documentOf(source, 'Note'))

describe('a resized picture written as an <img> tag, in Word and RTF exports', () => {
  test('keeps the picture when its caption is on the next line', () => {
    const note = 'Intro\n\n<img src="chart.png" alt="" style="zoom:50%;" />\n*Figure 1: sales*\n'
    expect(pictures(note)).toEqual(['chart.png'])
  })

  test('keeps the picture inside a centred paragraph', () => {
    expect(pictures('<p align="center"><img src="logo.png" alt="" width="300" /></p>\n')).toEqual(['logo.png'])
  })

  test('keeps the picture inside a centred block', () => {
    expect(pictures('<div align="center">\n<img src="logo.png" alt="" width="300" />\n</div>\n')).toEqual(['logo.png'])
  })
})
