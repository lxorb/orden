import JSZip from 'jszip'
import { describe, expect, test } from 'vitest'
import { pageSetupFor, paperTwips } from '../../page-setup'
import { DEFAULT_PAGE_SETUP, type PageSetup } from '../../paper'
import { documentOf } from './document'
import { toDocx } from './docx'
import { toRtf } from './rtf'

const NOTE = '# A page\n\nWords on it.\n'

const setup = (over: Partial<PageSetup> = {}): PageSetup => ({ ...DEFAULT_PAGE_SETUP, ...over })

async function docxPage(source: string, page: PageSetup) {
  const doc = documentOf(source, 'Note.md')
  const paper = paperTwips(pageSetupFor(source, page), doc.title, '2026-09-14')
  const zip = await JSZip.loadAsync(await toDocx(doc, [], paper))
  const xml = await zip.file('word/document.xml')!.async('string')

  const size = /<w:pgSz([^>]*)\/>/.exec(xml)?.[1] ?? ''
  const margin = /<w:pgMar([^>]*)\/>/.exec(xml)?.[1] ?? ''
  const attribute = (of: string, name: string) =>
    new RegExp(`w:${name}="(-?\\d+|portrait|landscape)"`).exec(of)?.[1] ?? null

  return {
    width: Number(attribute(size, 'w')),
    height: Number(attribute(size, 'h')),
    orientation: attribute(size, 'orient'),
    top: Number(attribute(margin, 'top')),
    left: Number(attribute(margin, 'left')),
    headers: Object.keys(zip.files).filter((one) => /word\/header\d*\.xml/.test(one)),
    footers: Object.keys(zip.files).filter((one) => /word\/footer\d*\.xml/.test(one)),
    zip,
  }
}

function rtfOf(source: string, page: PageSetup) {
  const doc = documentOf(source, 'Note.md')
  return toRtf(doc, [], paperTwips(pageSetupFor(source, page), doc.title, '2026-09-14'))
}

describe('the paper a Word document goes out on', () => {
  test('is the A4 the app defaults to, not the Letter Word assumes', async () => {
    const page = await docxPage(NOTE, setup())

    expect(page.width).toBe(11906)
    expect(page.height).toBe(16838)
    expect(page.orientation).toBe('portrait')
    expect(page.width).not.toBe(12240)
    expect(page.height).not.toBe(15840)
  })

  test('carries the margin the settings ask for rather than Word’s inch', async () => {
    const page = await docxPage(NOTE, setup())

    expect(page.top).toBe(1134)
    expect(page.left).toBe(1134)
    expect(page.top).not.toBe(1440)
  })

  test('is A5 turned on its side, with a 33 mm margin, when that is what was asked', async () => {
    const page = await docxPage(
      NOTE,
      setup({ paper: 'A5', orientation: 'landscape', margin: '33mm' }),
    )

    expect(page.width).toBe(11906)
    expect(page.height).toBe(8391)
    expect(page.orientation).toBe('landscape')
    expect(page.top).toBe(1871)
  })

  test('and the note’s own front matter overrules the settings', async () => {
    const over = '---\nexport:\n  paper: Legal\n  margin: 15mm\n---\n\n# A page\n'
    const page = await docxPage(over, setup({ paper: 'A4', margin: '20mm' }))

    expect(page.width).toBe(12240)
    expect(page.height).toBe(20160)
    expect(page.top).toBe(850)
  })

  test('writes a header and a footer part only when there is running text', async () => {
    const plain = await docxPage(NOTE, setup())
    expect(plain.headers).toEqual([])
    expect(plain.footers).toEqual([])

    const running = await docxPage(NOTE, setup({ header: '${title}', footer: 'page of ${date}' }))
    expect(running.headers.length).toBeGreaterThan(0)
    expect(running.footers.length).toBeGreaterThan(0)

    const header = await running.zip.file(running.headers[0]!)!.async('string')
    const footer = await running.zip.file(running.footers[0]!)!.async('string')
    expect(header).toContain('A page')
    expect(header).not.toContain('${title}')
    expect(footer).toContain('page of 2026-09-14')
  })
})

describe('the paper an RTF goes out on', () => {
  test('is the A4 the app defaults to, not the Letter that was written in by hand', () => {
    const rtf = rtfOf(NOTE, setup())

    expect(rtf).toContain('\\paperw11906\\paperh16838')
    expect(rtf).toContain('\\margl1134\\margr1134\\margt1134\\margb1134')
    expect(rtf).not.toContain('\\paperw12240\\paperh15840')
    expect(rtf).not.toContain('\\landscape')
  })

  test('is A5 on its side with a 33 mm margin when that is what was asked', () => {
    const rtf = rtfOf(NOTE, setup({ paper: 'A5', orientation: 'landscape', margin: '33mm' }))

    expect(rtf).toContain('\\paperw11906\\paperh8391')
    expect(rtf).toContain('\\landscape')
    expect(rtf).toContain('\\margl1871')
  })

  test('and the note’s own front matter overrules the settings', () => {
    const over = '---\nexport:\n  paper: A3\n  orientation: landscape\n---\n\n# A page\n'
    const rtf = rtfOf(over, setup())

    expect(rtf).toContain('\\paperw23811\\paperh16838')
    expect(rtf).toContain('\\landscape')
  })

  test('writes a header and a footer group only when there is running text', () => {
    expect(rtfOf(NOTE, setup())).not.toContain('{\\header')
    expect(rtfOf(NOTE, setup())).not.toContain('{\\footer')

    const running = rtfOf(NOTE, setup({ header: '${title}', footer: 'page of ${date}' }))
    expect(running).toContain('{\\header')
    expect(running).toContain('A page')
    expect(running).toContain('{\\footer')
    expect(running).toContain('page of 2026-09-14')
    expect(running).not.toContain('${title}')
  })

  test('and a reader cannot be talked out of the document by the running text', () => {
    const rtf = rtfOf(NOTE, setup({ header: 'a {brace} and a \\slash' }))

    expect(rtf).toContain('a \\{brace\\} and a \\\\slash')
  })
})

describe('the setup as a document writer needs it', () => {
  test('is the sheet upright, its margin, and the running text already filled', () => {
    expect(paperTwips(DEFAULT_PAGE_SETUP, 'A page', '2026-09-14')).toEqual({
      width: 11906,
      height: 16838,
      margin: 1134,
      landscape: false,
      header: '',
      footer: '',
    })
  })

  test('fills the placeholders the stylesheet fills, in the same words', () => {
    const said = paperTwips(
      { ...DEFAULT_PAGE_SETUP, header: '${title}', footer: '${date} · ${year}' },
      'A page',
      '2026-09-14',
    )

    expect(said.header).toBe('A page')
    expect(said.footer).toBe('2026-09-14 · 2026')
  })

  test('and falls back to the default margin for a length nothing could read', () => {
    expect(paperTwips({ ...DEFAULT_PAGE_SETUP, margin: 'wide' }, 'A', '2026-09-14').margin).toBe(
      1134,
    )
  })
})
