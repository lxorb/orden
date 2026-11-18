import { renderMarkdown } from '@orden/markdown'
import { applied } from '@orden/scan/search/replace'
import { describe, expect, test } from 'vitest'
import { plan, readEdits } from './edits'

function edited(text: string, edits: unknown): string {
  return applied(text, plan(readEdits(edits), text).edits)
}

const TABBED_THEN_TAB = '- Trip\n\t- Packing ^pack\n  - Tickets\n- Home\n'

const TASKS_TABBED_THEN_TAB = '- [ ] Trip\n\t- [ ] Packing\n  - [ ] Tickets\n- [ ] Home\n'

describe('a tab-nested item with a sibling the editor Tab indented with spaces', () => {
  test('deleting the item by its id keeps the sibling', () => {
    const after = edited(TABBED_THEN_TAB, [{ at: { block: 'pack' }, delete: true }])
    expect(after).toContain('Tickets')
  })

  test('replacing the item by its id keeps the sibling', () => {
    const after = edited(TABBED_THEN_TAB, [{ at: { block: 'pack' }, replace: '- Packed' }])
    expect(after).toContain('Tickets')
  })

  test('a task added after the sub-task does not nest under the sibling', () => {
    const after = edited(TASKS_TABBED_THEN_TAB, [
      { at: { task: 'Packing' }, insert_after: '- [ ] Visa' },
    ])
    expect(renderMarkdown(after)).not.toMatch(/Tickets<ul>/)
  })
})
