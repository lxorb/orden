// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { htmlToMarkdown } from '@orden/markdown/from-html'
import { pastedMarkdown } from './paste'

async function shown(html: string, text: string): Promise<string> {
  return renderMarkdown((await pastedMarkdown(html, text)) ?? '')
}
describe('a link whose words start with a superscript', () => {
  test('a pandoc note mark stays a link and is not read as a footnote', async () => {
    const html =
      '<p>Words<a href="https://example.com/notes#fn1" class="footnote-ref" id="fnref1" role="doc-noteref"><sup>1</sup></a> more.</p>'
    const drawn = await shown(html, 'Words1 more.')
    expect(drawn).toContain('href="https://example.com/notes#fn1"')
    expect(drawn).not.toContain('footnote-ref')
    expect(drawn).not.toContain('(https://example.com/notes#fn1)')
  })
  test('a raised Google Docs span inside a link stays a link', async () => {
    const html = '<p>Words<a href="https://example.com/cite"><span style="vertical-align:super">2</span></a> more.</p>'
    const drawn = await shown(html, 'Words2 more.')
    expect(drawn).toContain('href="https://example.com/cite"')
    expect(drawn).not.toContain('footnote-ref')
  })
})
describe('struck words whose strike is written twice', () => {
  test('a struck span inside a del is struck once and does not open a code fence', async () => {
    const html = '<p><del><span style="text-decoration:line-through">Old plan</span></del></p><p>New plan</p>'
    const drawn = await shown(html, 'Old plan\nNew plan')
    expect(drawn).toContain('<del>Old plan</del>')
    expect(drawn).toContain('<p>New plan</p>')
    expect(drawn).not.toContain('<pre>')
  })
  test('a struck span inside a struck span is struck once', async () => {
    const struck = 'text-decoration:line-through'
    const html = `<p>Price <span style="${struck}"><span style="${struck}">$49</span></span> $29</p>`
    const drawn = await shown(html, 'Price $49 $29')
    expect(drawn).toContain('<del>$49</del>')
    expect(drawn).not.toContain('~~')
  })
})
describe('a Notion list item with several nested items', () => {
  const IMPORTING = { fileTargets: true, appTargets: true, mediaLinks: true, plainTasks: true }
  const bullet = (words: string, inside = '') =>
    `<ul class="bulleted-list"><li style="list-style-type:disc">${words}${inside}</li></ul>`
  test('stays one tight list', () => {
    const html = `<div class="page-body">${bullet('Milk')}${bullet('Bread', bullet('Rye') + bullet('Spelt'))}${bullet('Jam')}</div>`
    const markdown = htmlToMarkdown(html, IMPORTING)
    expect(markdown).toBe('- Milk\n- Bread\n  - Rye\n  - Spelt\n- Jam')
    expect(renderMarkdown(markdown)).not.toContain('<p>')
  })
})
