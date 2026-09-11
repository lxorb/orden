import { describe, expect, test } from 'vitest'

import { readKeep } from './keep'
import type { ImportPlan } from './plan'
import { sourceOf, type Source } from './sources'

function file(path: string, body: string): Source {
  return sourceOf(path, new TextEncoder().encode(body))
}

function noteAt(plan: ImportPlan, path: string): string {
  const found = plan.files.find((one) => one.path === path)
  if (!found || found.kind !== 'note') throw new Error(`no note at ${path}`)
  return found.text
}

function keepNote(note: Record<string, unknown>): string {
  return JSON.stringify(note)
}

describe('a Google Keep export', () => {
  test('becomes a note with its labels as tags and its dates', async () => {
    const plan = await readKeep([
      file(
        'Takeout/Keep/Shopping.json',
        keepNote({
          title: 'Shopping',
          textContent: 'Bread and milk',
          labels: [{ name: 'Home' }, { name: 'to do' }],
          createdTimestampUsec: 1767355200000000,
          userEditedTimestampUsec: 1769947200000000,
          color: 'DEFAULT',
        }),
      ),
    ])

    const text = noteAt(plan, 'Shopping.md')
    expect(text).toContain('date: 2026-01-02')
    expect(text).toContain('tags: [Home, to-do]')
    expect(text).toContain('Bread and milk')
  })

  test('a list is a task list, in the state it was left in', async () => {
    const plan = await readKeep([
      file(
        'Keep/List.json',
        keepNote({
          title: 'Packing',
          listContent: [
            { text: 'Passport', isChecked: true },
            { text: 'Socks', isChecked: false },
          ],
        }),
      ),
    ])

    const text = noteAt(plan, 'Packing.md')
    expect(text).toContain('- [x] Passport')
    expect(text).toContain('- [ ] Socks')
  })

  test('a picture beside the note comes with it', async () => {
    const plan = await readKeep([
      file('Keep/Shot.json', keepNote({ title: 'Shot', attachments: [{ filePath: 'shot.jpeg' }] })),
      file('Keep/shot.jpeg', 'JPEG'),
    ])

    expect(plan.files.some((one) => one.path === 'assets/shot.jpeg')).toBe(true)
    expect(noteAt(plan, 'Shot.md')).toContain('![](assets/shot.jpeg)')
  })

  test('what was in the bin stays there, and is counted', async () => {
    const plan = await readKeep([
      file('Keep/Gone.json', keepNote({ title: 'Gone', textContent: 'x', isTrashed: true })),
      file('Keep/Here.json', keepNote({ title: 'Here', textContent: 'y' })),
    ])

    expect(plan.files.map((one) => one.path)).toEqual(['Here.md'])
    expect(plan.lost[0]?.text).toContain('bin')
    expect(plan.lost[0]?.values).toEqual({ count: 1 })
  })

  test('an archived note goes to a folder called Archive, and says so', async () => {
    const plan = await readKeep([
      file('Keep/Old.json', keepNote({ title: 'Old', textContent: 'x', isArchived: true })),
    ])

    expect(plan.files[0]?.path).toBe('Archive/Old.md')
    expect(plan.lost.some((one) => one.text.includes('Archive'))).toBe(true)
  })

  test('a colour is mentioned rather than kept', async () => {
    const plan = await readKeep([
      file('Keep/A.json', keepNote({ title: 'A', textContent: 'x', color: 'TEAL' })),
    ])

    expect(plan.lost.some((one) => one.text.includes('colours'))).toBe(true)
  })

  test('a note with no title is named after what it says', async () => {
    const plan = await readKeep([
      file('Keep/1600000.json', keepNote({ textContent: 'Ring the dentist' })),
    ])

    expect(plan.files[0]?.path).toBe('Ring the dentist.md')
  })

  test("Takeout's own JSON files are not notes", async () => {
    const plan = await readKeep([
      file('Takeout/archive_browser.html', '<html></html>'),
      file('Takeout/Keep/Labels.txt', 'Home\nWork'),
      file('Takeout/settings.json', '{"version":2}'),
    ])

    expect(plan.files).toHaveLength(0)
  })
})
