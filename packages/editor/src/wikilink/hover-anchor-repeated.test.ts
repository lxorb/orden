import { EditorState } from '@codemirror/state'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import { previewNoteOf } from './hover'

function landing(source: string, block: string) {
  const section = sectionOf(source, { heading: null, block })
  if (section === null) throw new Error('no section')
  return previewNoteOf(EditorState.create({}), 'Week.md', source, section, { heading: null, block })
    .at
}

describe('the hover card of a link to a named block', () => {
  test('opens at the named task, not an earlier task with the same words', () => {
    const source = '## Monday\n\n- [ ] call mum\n\n## Tuesday\n\n- [ ] call mum ^tue\n'
    expect(landing(source, 'tue')).toBe(source.indexOf('- [ ] call mum ^tue'))
  })

  test('opens at the named paragraph, not an earlier paragraph with the same words', () => {
    const source = '## Monday\n\nRemember the milk.\n\n## Tuesday\n\nRemember the milk. ^tue\n'
    expect(landing(source, 'tue')).toBe(source.indexOf('Remember the milk. ^tue'))
  })
})
