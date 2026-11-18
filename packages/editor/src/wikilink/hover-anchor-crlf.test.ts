import { EditorState } from '@codemirror/state'
import { sectionOf } from '@orden/markdown/links'
import { describe, expect, test } from 'vitest'
import { previewNoteOf } from './hover'

const lines = [
  '---',
  'title: Week',
  '---',
  '',
  '# Week',
  '',
  ...Array.from({ length: 30 }, (_, day) => `- day ${day}`),
  '',
  '## Plans',
  '',
  'Call the bank. ^bank',
  '',
]

const source = lines.join('\r\n')

function landing(link: { heading: string | null; block: string | null }) {
  const section = sectionOf(source, link)
  if (section === null) throw new Error('no section')
  return previewNoteOf(EditorState.create({}), 'Week.md', source, section, link).at
}

function startOfLine(text: string) {
  const card = EditorState.create({ doc: source })
  return card.doc.line(lines.indexOf(text) + 1).from
}

describe('the hover card of a link into a note with Windows line ends', () => {
  test('opens at the start of the named block', () => {
    expect(landing({ heading: null, block: 'bank' })).toBe(startOfLine('Call the bank. ^bank'))
  })

  test('opens at the start of the linked heading', () => {
    expect(landing({ heading: 'Plans', block: null })).toBe(startOfLine('## Plans'))
  })
})
