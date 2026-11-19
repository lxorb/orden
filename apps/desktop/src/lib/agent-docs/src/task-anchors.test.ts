import { describe, expect, test } from 'vitest'
import { renderMarkdown } from '@orden/markdown'
import { applied } from '@orden/scan/search/replace'
import { plan, readEdits } from './edits'

function edited(text: string, edits: unknown): string {
  return applied(text, plan(readEdits(edits), text).edits)
}

const TRIP = '- [ ] Trip\n  - [ ] Book\n  - [ ] Pack\n- [ ] Call\n'

describe('a task named by its words, as the read lists it', () => {
  test('ticked keeps the block id that links to it', () => {
    const text = '- [ ] Buy milk ^milk\n- [ ] Call\n'
    const after = edited(text, [{ at: { task: 'Buy milk' }, replace: '- [x] Buy milk' }])
    expect(after).toBe('- [x] Buy milk ^milk\n- [ ] Call\n')
  })

  test('a ticked sub-task stays under its parent', () => {
    const after = edited(TRIP, [{ at: { task: 'Book' }, replace: '- [x] Book' }])
    expect(after).toBe('- [ ] Trip\n  - [x] Book\n  - [ ] Pack\n- [ ] Call\n')
  })

  test('a task added after a parent task leaves the sub-tasks with their parent', () => {
    const after = edited(TRIP, [{ at: { task: 'Trip' }, insert_after: '- [ ] Visa' }])
    const html = renderMarkdown(after)
    expect(html).toMatch(/Trip<ul>/)
    expect(html).not.toMatch(/Visa<ul>/)
  })

  test('words added after a task do not join the task', () => {
    const after = edited('- [ ] Call\n- [ ] Two\n', [{ at: { task: 'Call' }, insert_after: 'Ask about the date.' }])
    expect(renderMarkdown(after)).toContain('<p>Ask about the date.</p>')
  })
})
