import { headingsOf, sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'

describe('a line starting with # that is not a heading', () => {
  test('a comment line in the front matter is not listed as a heading', () => {
    expect(headingsOf('---\n# settings for the export\ntitle: x\n---\n# Real\n')).toEqual(['Real'])
  })

  test('a heading inside an HTML comment is not listed as a heading', () => {
    expect(headingsOf('# Real\n<!--\n# Old plan\n-->\ntext\n')).toEqual(['Real'])
  })

  test('a heading inside an HTML comment does not end the section embedded above it', () => {
    const source = '# Plans\n<!--\n# Old plan\n-->\nCall the bank\n\n# Next\n'
    expect(sectionOf(source, { heading: 'Plans', block: null })).toContain('Call the bank')
  })
})
