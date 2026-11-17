import { headingsOf, sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { editorState } from './editor'
import { headings } from './live-preview/toc'

const NOTE = '# Plans\n\nSee the bank %%ask about\nthe fee\n%%\n\n# Later\n\nCall the bank\n'

describe('a percent comment opened mid-line and closed on a line of its own', () => {
  test('the headings after it are still listed', () => {
    expect(headingsOf(NOTE)).toEqual(['Plans', 'Later'])
  })

  test('the headings after it agree with the table of contents', () => {
    const drawn = headings(parsed(editorState({ doc: NOTE }))).map((one) => one.text)
    expect(headingsOf(NOTE)).toEqual(drawn)
  })

  test('a heading after it can still be embedded', () => {
    expect(sectionOf(NOTE, { heading: 'Later', block: null })).toBe('# Later\n\nCall the bank')
  })
})
