import { withoutComments } from '@orden/markdown/comments'
import { applied } from '@orden/scan/search/replace'
import { describe, expect, test } from 'vitest'
import { plan, readEdits } from './edits'
import { headingsIn } from './anchors'

const NOTE = [
  '# Plan',
  '',
  '## Tasks',
  '',
  '- Buy milk',
  '',
  '%%',
  '## Ideas',
  'half a thought',
  '%%',
  '',
  '## Done',
  '',
  '- Paid rent',
  '',
].join('\n')

function edited(edits: unknown): string {
  return applied(NOTE, plan(readEdits(edits), NOTE).edits)
}

describe('a section with a %% commented-out heading under it', () => {
  test('the outline lists only the headings the reader sees', () => {
    expect(headingsIn(NOTE).map((one) => one.title)).toEqual(['Plan', 'Tasks', 'Done'])
  })

  test('adding under Tasks lands outside the comment', () => {
    const after = edited([{ at: { heading: 'Tasks' }, insert_after: '- Call mum' }])
    expect(withoutComments(after)).toContain('- Call mum')
  })

  test('replacing the Tasks section leaves no lone %% hiding the sections below', () => {
    const after = edited([{ at: { heading: 'Tasks' }, replace: '## Tasks\n\n- Nothing left' }])
    expect(withoutComments(after)).toContain('- Paid rent')
  })

  test('deleting Tasks above an HTML-commented heading keeps the commented words hidden', () => {
    const note = NOTE.replace('%%\n## Ideas', '<!--\n## Ideas').replace('thought\n%%', 'thought\n-->')
    const after = applied(note, plan(readEdits([{ at: { heading: 'Tasks' }, delete: true }]), note).edits)
    expect(withoutComments(after)).not.toContain('half a thought')
  })
})
