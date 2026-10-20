import { readBase } from '@nib/bases'
import { describe, expect, test } from 'vitest'
import { movedWords } from './order-paths'

const BASE = `views:
  - type: kanban
    name: Board
    nib:
      order:
        Doing:
          - Plans/Ship.md
          - Plans/Write.md
`

describe('a board following its cards', () => {
  test('renames a card in a .base file', () => {
    const after = movedWords(BASE, false, 'Plans/Ship.md', 'Plans/Launch.md')
    expect(readBase(after ?? '').views[0]?.nib.order?.Doing).toEqual([
      'Plans/Launch.md',
      'Plans/Write.md',
    ])
  })

  test('and in a database note’s fence, leaving the rest of the note', () => {
    const note = `# Plans\n\n\`\`\`base\n${BASE}\`\`\`\n\nAfter.\n`
    const after = movedWords(note, true, 'Plans', 'Projects') ?? ''
    expect(after.startsWith('# Plans\n\n```base\n')).toBe(true)
    expect(after.endsWith('```\n\nAfter.\n')).toBe(true)
    const body = after.split('```base\n')[1]?.split('```')[0] ?? ''
    expect(readBase(body).views[0]?.nib.order?.Doing).toEqual([
      'Projects/Ship.md',
      'Projects/Write.md',
    ])
  })

  test('and writes nothing where nothing named it', () => {
    expect(movedWords(BASE, false, 'Other.md', 'Else.md')).toBeNull()
  })
})
