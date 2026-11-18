import { renderMarkdown } from '@orden/markdown'
import { describe, expect, test } from 'vitest'
import { toMarkdown } from './markdown'

const exported = (source: string) => toMarkdown(source, { link: () => 'sub/Note.md' })

const hrefOf = (markdown: string) => /href="([^"]*)"/.exec(renderMarkdown(markdown))?.[1] ?? ''

describe('a wikilink to a heading, exported as Markdown', () => {
  test('still points at the note, with the heading after a real # and not inside the file name', () => {
    const href = hrefOf(exported('See [[Note#The heading]].\n'))
    expect(href.split('#')[0]).toBe('sub/Note.md')
  })

  test('keeps the heading as the fragment of the link', () => {
    const href = hrefOf(exported('See [[Note#The heading]].\n'))
    expect(decodeURIComponent(href.slice(href.indexOf('#') + 1))).toBe('The heading')
  })
})

test('a wikilink to a block, exported as Markdown, keeps the block as the fragment', () => {
  expect(exported('See [[Note#^abc]].\n')).toContain('(sub/Note.md#%5Eabc)')
})
