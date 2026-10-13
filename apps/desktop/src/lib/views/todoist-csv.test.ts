import { taskRowsOfText } from '@nib/bases/tasks'
import { describe, expect, test } from 'vitest'
import { csvProject, planOf } from '../import/todoist'
import { todoistCsv } from './todoist-csv'

const NOTE = [
  '# Launch',
  '- [ ] Book the room #venue 🔺 📅 2026-10-20',
  '  The big one, upstairs.',
  '  - [ ] Ask about chairs',
  '  - Called on Monday.',
  '',
  '## Press',
  '- [ ] Write the release 🔁 every week',
].join('\n')

describe('a project as Todoist’s CSV', () => {
  const rows = taskRowsOfText('Notes', 'Projects/Launch.md', NOTE)
  const csv = todoistCsv(rows, (line) => (line === 1 ? ['Called on Monday.'] : []))

  test('has Todoist’s columns, a row per task, section and comment', () => {
    const lines = csv.trim().split('\r\n')
    expect(lines[0]?.startsWith('TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT')).toBe(true)
    expect(lines.map((one) => one.split(',')[0])).toEqual([
      'TYPE',
      'task',
      'note',
      'task',
      'section',
      'task',
    ])
    expect(csv).toContain('Book the room @venue')
  })

  test('comes back through nib’s own importer as it was', () => {
    const plan = planOf(csvProject('Launch', csv, 0))
    const file = plan.files[0]
    const text = file?.kind === 'note' ? file.text : ''
    expect(file?.path).toBe('Projects/Launch.md')
    expect(text).toContain('Book the room')
    expect(text).toContain('#venue')
    expect(text).toContain('🔺')
    expect(text).toContain('2026-10-20')
    expect(text).toMatch(/\n {2}- \[ \] Ask about chairs/)
    expect(text).toContain('## Press')
    expect(text).toContain('every week')
  })
})
