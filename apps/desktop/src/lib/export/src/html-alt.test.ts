import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'
import { DEFAULT_PAGE_SETUP } from '@orden/contracts'
import { paperTwips } from '../../files-out/src/api'
import { documentOf } from './document'
import { toDocx } from './docx'
import { toPlainText } from './text'

const PAPER = paperTwips(DEFAULT_PAGE_SETUP, 'Alt', '2026-11-18')

function be32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]
}

function pngOf(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ])
}

const SHOT = { src: 'shot.png', name: 'shot.png', mime: 'image/png', bytes: pngOf(800, 400) }

const RESIZED = '<img src="shot.png" alt="Q&amp;A &quot;draft&quot;" style="zoom:50%;" />\n'

describe('a resized picture whose description holds & or a quote, in exports', () => {
  test('the text export shows the description as written', () => {
    expect(toPlainText(documentOf(RESIZED, 'Alt.md'))).toBe('[Q&A "draft"]\n')
  })

  test('the Word caption shows the description as written', async () => {
    const bytes = await toDocx(documentOf(RESIZED, 'Alt.md'), [SHOT], PAPER)
    const xml = await (await JSZip.loadAsync(bytes)).file('word/document.xml')?.async('string')
    expect(xml).toContain('Q&amp;A &quot;draft&quot;</w:t>')
    expect(xml).not.toContain('&amp;amp;')
  })
})
