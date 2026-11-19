import { describe, expect, test } from 'vitest'
import { headingRows, headingsOf, sectionOf } from '@orden/markdown/links'
import { scanRows } from '@orden/bases/scan'
import { scanNote } from '@orden/scan/note'
import { scanHeadings } from '../src/lib/documents/src/outline'
import { headingsIn } from '../src/lib/agent-docs/src/anchors'
import { headingOffsets } from '../src/lib/reading/src/places'

const note = [
  '---',
  'title: x',
  '---',
  '',
  'Intro',
  '=====',
  '',
  '- [ ] first',
  '',
  'Plan for',
  'the week',
  '--------',
  '',
  '- [ ] second',
  '',
  '## Done ##',
  '',
  '- [ ] third',
  '',
  'text',
  '',
  '---',
  '',
  '- item',
  '---',
  '',
  '> quoted',
  'lazy',
  '===',
  '',
  '```',
  'Code',
  '===',
  '```',
  '',
].join('\n')
const lineOf = (words: string) => note.slice(0, note.indexOf(words)).split('\n').length - 1
const wanted = [
  { level: 1, text: 'Intro', line: lineOf('Intro') },
  { level: 2, text: 'Plan for the week', line: lineOf('Plan for') },
  { level: 2, text: 'Done', line: lineOf('## Done') },
]
describe('a heading underlined with = or - is a heading wherever headings are read', () => {
  test('the one scanner', () => {
    const starts = [note.indexOf('Intro'), note.indexOf('Plan for'), note.indexOf('## Done')]
    expect(headingRows(note)).toEqual(wanted.map((one, at) => ({ ...one, from: starts[at] })))
  })
  test('the outline', () => {
    expect(scanHeadings(note)).toEqual(wanted)
  })
  test('the reading view', () => {
    expect(headingOffsets(note)).toEqual(headingRows(note).map((one) => one.from))
  })
  test('links to a heading, and the index of a note', () => {
    expect(headingsOf(note)).toEqual(['Intro', 'Plan for the week', 'Done'])
    expect(scanNote('Note.md', note).headings).toEqual(['Intro', 'Plan for the week', 'Done'])
    expect(sectionOf(note, { heading: 'plan-for-the-week', block: null })).toBe(
      'Plan for\nthe week\n--------\n\n- [ ] second',
    )
  })
  test('the places an agent names', () => {
    expect(headingsIn(note).map((one) => [one.level, one.title, one.path, one.line])).toEqual([
      [1, 'Intro', [], lineOf('Intro')],
      [2, 'Plan for the week', ['Intro'], lineOf('Plan for')],
      [2, 'Done', ['Intro'], lineOf('## Done')],
    ])
  })
  test('the section a task sits in', () => {
    expect(scanRows(note).tasks.map((one) => one.section)).toEqual([
      ['Intro'],
      ['Intro', 'Plan for the week'],
      ['Intro', 'Done'],
    ])
  })
})
