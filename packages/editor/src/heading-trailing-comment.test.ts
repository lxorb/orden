import { renderMarkdown } from '@orden/markdown'
import { headingsOf, sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { editorState } from './editor'
import { headings } from './live-preview/toc'

const NOTE = '# Plans %%draft%%\n\nCall the bank\n\n# Later <!-- todo -->\n\nPay the fee\n'
describe('a heading with a comment at its end', () => {
  test('the reading view names the headings without their comments', () => {
    const html = renderMarkdown(NOTE, { toc: true })
    expect(html).toContain('<h1 id="plans">Plans</h1>')
    expect(html).toContain('<h1 id="later">Later</h1>')
  })
  test('heading links offer the names the reading view shows', () => {
    expect(headingsOf(NOTE)).toEqual(['Plans', 'Later'])
  })
  test('a link to the shown name can be embedded and hovered', () => {
    expect(sectionOf(NOTE, { heading: 'Plans', block: null })).toBe('# Plans %%draft%%\n\nCall the bank')
    expect(sectionOf(NOTE, { heading: 'Later', block: null })).toBe('# Later <!-- todo -->\n\nPay the fee')
  })
  test('the drawn table of contents leaves the comments out', () => {
    const drawn = headings(parsed(editorState({ doc: NOTE }))).map((one) => one.text)
    expect(drawn).toEqual(['Plans', 'Later'])
  })
})
