// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { renderMarkdown } from '@orden/markdown'
import { htmlToMarkdown } from '@orden/markdown/from-html'

const IMPORTING = { fileTargets: true, appTargets: true, mediaLinks: true, plainTasks: true }

function bullet(words: string, inside = ''): string {
  return `<ul id="b-${words}" class="bulleted-list"><li style="list-style-type:disc">${words}${inside}</li></ul>`
}

function numbered(words: string, at: number): string {
  return `<ol type="1" id="n-${words}" class="numbered-list" start="${at}"><li>${words}</li></ol>`
}

describe('a list written by Notion, one list element for each item', () => {
  test('is one tight bulleted list, as Notion drew it', () => {
    const sub = '<ul id="b-sub" class="bulleted-list"><li style="list-style-type:circle">Sub</li></ul>'
    const html = `<div class="page-body">${bullet('Milk')}${bullet('Eggs')}${bullet('Bread', sub)}</div>`
    const markdown = htmlToMarkdown(html, IMPORTING)
    expect(markdown).toBe('- Milk\n- Eggs\n- Bread\n  - Sub')
    expect(renderMarkdown(markdown)).not.toContain('<p>')
  })

  test('is one tight numbered list, as Notion drew it', () => {
    const html = `<div class="page-body">${numbered('One', 1)}${numbered('Two', 2)}${numbered('Three', 3)}</div>`
    const markdown = htmlToMarkdown(html, IMPORTING)
    expect(markdown).toBe('1. One\n2. Two\n3. Three')
    expect(renderMarkdown(markdown)).not.toContain('<p>')
  })
})
