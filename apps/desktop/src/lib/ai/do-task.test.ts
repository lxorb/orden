import type { Row } from '@nib/bases'
import { expect, test, vi } from 'vitest'

vi.mock('../workspace.svelte', () => ({ workspace: { spaces: [] } }))
const { askOf } = await import('./do-task')

test('a task done with AI is handed over with its words and where update_task ticks it', () => {
  const row = { space: 'Home', path: 'Errands.md', anchor: { line: 3, hash: 'abc' } } as Row
  const asked = askOf(row, 'Book the dentist')
  expect(asked).toContain('update_task (done: true)')
  expect(asked).toContain(
    'Task: Book the dentist\nSpace: Home\nNote: Errands.md\nAt: Errands.md#3:abc',
  )
})
