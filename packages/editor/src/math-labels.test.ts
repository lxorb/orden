import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { prepare } from './live-preview/render'

const note = 'Mass and energy:\n\n$$\nE = mc^2 \\label{eq:mass}\n$$\n\nThat is all.\n'

describe('an equation with a label in the reading view', () => {
  test('the editor treats the label as bookkeeping', () => {
    expect(prepare('E = mc^2 \\label{eq:mass}')).not.toContain('\\label')
  })

  test('draws the equation without an error for the label', () => {
    const html = renderMarkdown(note, { footnotes: true, toc: true, blockAnchors: true })
    expect(html).toContain('class="math-block"')
    expect(html).not.toContain('color:#cc0000')
    expect(html).not.toContain('>\\label<')
  })
})
