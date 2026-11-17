import { EditorState } from '@codemirror/state'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import { previewNoteOf } from './hover'

function landing(source: string, link: { heading: string | null; block: string | null }) {
  const section = sectionOf(source, link)
  if (section === null) throw new Error('no section')
  return previewNoteOf(EditorState.create({}), 'Code.md', source, section).at
}

describe('the hover card of a link into a note', () => {
  test('opens at the named fence, not an earlier fence of the same language', () => {
    const source = '# Code\n\n```js\nfirst()\n```\n\n```js\nsecond()\n```\n\n^second\n'
    expect(landing(source, { heading: null, block: 'second' })).toBe(
      source.indexOf('```js\nsecond'),
    )
  })

  test('opens at the named table, not an earlier table with the same header', () => {
    const source =
      '## Week 1\n\n| Day | Done |\n| --- | --- |\n| Mon | yes |\n\n## Week 2\n\n| Day | Done |\n| --- | --- |\n| Tue | no |\n\n^week2\n'
    expect(landing(source, { heading: null, block: 'week2' })).toBe(source.lastIndexOf('| Day'))
  })

  test('opens at the linked heading, not an earlier heading that starts with its words', () => {
    const source = '# Plan\n\n## Tasks for Monday\n\nCall.\n\n## Tasks\n\nWrite.\n'
    expect(landing(source, { heading: 'Tasks', block: null })).toBe(source.indexOf('## Tasks\n'))
  })
})
