import { readBase } from '@nib/bases'
import { describe, expect, test } from 'vitest'
import { renamedGroup } from './edit'

const base = readBase(`filters: 'note.priority == "Low" || note.status == "Low"'
views:
  - type: kanban
    name: Board
    groupBy:
      property: note.status
      direction: ASC
    filters: 'status != "Low" && priority == "Low"'
  - type: table
    name: Table
    filters:
      and:
        - '"Low" == status'
        - 'status.contains("Low") && tags.contains("Low")'
        - 'note["status"] != "Low"'
`)

describe('an option renamed in the filters', () => {
  test('only comparisons of the renamed property change, not another with the same words', () => {
    const renamed = renamedGroup(base, 'note.status', 'Low', 'Backlog')
    expect(renamed.filters).toBe('note.priority == "Low" || note.status == "Backlog"')
    expect(renamed.views[0]?.filters).toBe('status != "Backlog" && priority == "Low"')
    expect(renamed.views[1]?.filters).toEqual({
      and: [
        '"Backlog" == status',
        'status.contains("Backlog") && tags.contains("Low")',
        'note["status"] != "Backlog"',
      ],
    })
  })
})
