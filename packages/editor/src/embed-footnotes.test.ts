// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'

const recipe = '# Recipe\n\nBake it.[^1]\n\n[^1]: At 200 degrees.\n'
const note = 'Plan for today.[^1]\n\n![[Recipe]]\n\n[^1]: Buy flour first.\n'

function read(): HTMLElement {
  const page = document.createElement('div')
  page.innerHTML = renderMarkdown(note, {
    footnotes: true,
    blockAnchors: true,
    toc: true,
    escapeHtml: true,
    resolveEmbed: () => recipe,
  })
  return page
}

describe('footnotes of a note embedded in the reading view', () => {
  test('the note own footnote mark leads to its own footnote', () => {
    const page = read()
    const mark = page.querySelector<HTMLAnchorElement>('p > sup.footnote-ref > a')
    const wanted = mark?.getAttribute('href')?.slice(1) ?? ''
    const landing = page.querySelector(`[id="${wanted}"]`)
    expect(landing?.textContent).toContain('Buy flour first.')
  })

  test('gives every footnote and footnote mark its own id', () => {
    const ids = [...read().querySelectorAll('[id]')].map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('wraps the embedded footnotes in one footnote list', () => {
    const html = read().innerHTML
    expect(html).not.toContain('<ol><section class="footnotes">')
  })
})
