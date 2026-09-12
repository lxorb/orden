import { describe, expect, test } from 'vitest'
import {
  DIAGRAM_LANGUAGES,
  DIAGRAM_SCHEMES,
  diagramAlt,
  diagramFigure,
  diagramKey,
  isDiagram,
} from './diagrams'

const SPACE = '7d1f4e8c-0000-4000-8000-000000000001'
const CODE = 'graph TD\n  A[A note] --> B[A published page]\n'

describe('which fences are a picture', () => {
  test('is the three the editor and the exporter draw', () => {
    expect([...DIAGRAM_LANGUAGES]).toEqual(['mermaid', 'flow', 'sequence'])
  })

  test('reads a language whatever case it was written in', () => {
    expect(isDiagram('mermaid')).toBe(true)
    expect(isDiagram('Mermaid')).toBe(true)
    expect(isDiagram('SEQUENCE')).toBe(true)
    // A chart is built as a string of SVG on every surface and needs no picture.
    expect(isDiagram('chart')).toBe(false)
    expect(isDiagram('ts')).toBe(false)
    expect(isDiagram('')).toBe(false)
  })
})

describe('what a diagram is named by', () => {
  test('is a hash, and the same one twice', async () => {
    const once = await diagramKey(SPACE, 'mermaid', CODE, 'light')
    const again = await diagramKey(SPACE, 'mermaid', CODE, 'light')

    expect(once).toMatch(/^[a-f0-9]{64}$/)
    expect(again).toBe(once)
  })

  test('is one name per scheme, because there is one picture per scheme', async () => {
    const [light, dark] = await Promise.all(
      DIAGRAM_SCHEMES.map((scheme) => diagramKey(SPACE, 'mermaid', CODE, scheme)),
    )

    expect(light).not.toBe(dark)
  })

  test('changes with a character of the diagram, so an edit is a new picture', async () => {
    const was = await diagramKey(SPACE, 'mermaid', CODE, 'light')
    const now = await diagramKey(SPACE, 'mermaid', `${CODE}  B --> C[And another]\n`, 'light')

    expect(now).not.toBe(was)
  })

  test('does not change with the case a fence was opened in', async () => {
    expect(await diagramKey(SPACE, 'Mermaid', CODE, 'light')).toBe(
      await diagramKey(SPACE, 'mermaid', CODE, 'light'),
    )
  })

  test('changes with the language, since the same text draws differently', async () => {
    expect(await diagramKey(SPACE, 'sequence', CODE, 'light')).not.toBe(
      await diagramKey(SPACE, 'mermaid', CODE, 'light'),
    )
  })

  /** The one property that is about safety rather than about caching: the name is
   *  derived from text a reader of the page can see, so what keeps a stranger from
   *  computing it and writing their own picture under it is the space's own id. */
  test('is a different name in another space, so nobody can compute it off the page', async () => {
    const other = '7d1f4e8c-0000-4000-8000-000000000002'

    expect(await diagramKey(other, 'mermaid', CODE, 'light')).not.toBe(
      await diagramKey(SPACE, 'mermaid', CODE, 'light'),
    )
  })
})

describe('what a reader who cannot see it is told', () => {
  test("is mermaid's own description where the author wrote one", () => {
    expect(diagramAlt('graph TD\n  accDescr: How a note reaches a page\n  A --> B\n')).toBe(
      'How a note reaches a page',
    )
  })

  test('is the title where that is all there is', () => {
    expect(diagramAlt('graph TD\n  accTitle: The pipeline\n  A --> B\n')).toBe('The pipeline')
  })

  test('is never the first line of the fence', () => {
    expect(diagramAlt('graph TD\n  A --> B\n')).toBe('Diagram')
  })
})

describe('the figure a drawn fence becomes', () => {
  test('is one picture per scheme, inside the frame an export writes', () => {
    const html = diagramFigure('mermaid', 'Diagram', {
      light: '/i/aaa.svg',
      dark: '/i/bbb.svg',
    })

    expect(html).toBe(
      '<figure class="diagram" data-language="mermaid">' +
        '<img src="/i/aaa.svg" alt="Diagram" data-scheme="light">' +
        '<img src="/i/bbb.svg" alt="Diagram" data-scheme="dark">' +
        '</figure>\n',
    )
  })

  test('is one picture with nothing to switch where only the light one is there', () => {
    const html = diagramFigure('flow', 'Diagram', { light: '/i/aaa.svg', dark: null })

    expect(html).toBe(
      '<figure class="diagram" data-language="flow">' +
        '<img src="/i/aaa.svg" alt="Diagram">' +
        '</figure>\n',
    )
  })

  test('escapes what the author wrote, since the alt text is the note talking', () => {
    const html = diagramFigure('mermaid', '"><script>alert(1)</script>', {
      light: '/i/aaa.svg',
      dark: null,
    })

    expect(html).not.toContain('<script')
    expect(html).toContain('alt="&quot;&gt;&lt;script&gt;')
  })
})
