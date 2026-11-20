import { describe, expect, test } from 'vitest'
import { valueText } from './chips'
import { groupLabel, noteNames } from './words'

const link = (target: string) => ({ kind: 'link' as const, target })
describe('a note a view names (#2310)', () => {
  test('a link value shows its name without the ending of any kind Orden opens', () => {
    const cases: [string, string][] = [
      ['Work/Board.canvas', 'Board'],
      ['Plan.md', 'Plan'],
      ['Team.chat', 'Team'],
      ['Build.term', 'Build'],
      ['Tasks.base', 'Tasks'],
      ['Notes.pages', 'Notes'],
      ['Site.url', 'Site'],
      ['photo.png', 'photo.png'],
    ]
    for (const [target, name] of cases) {
      expect(valueText(link(target), '2026-11-20')).toBe(name)
    }
  })
  test('a group of a note is headed by the name it shows', () => {
    const keys = ['Work/Board.canvas', 'Plan.md']
    const names = noteNames(keys)
    expect([...names.keys()]).toEqual(['Board', 'Plan'])
    expect(groupLabel('file.path', 'Work/Board.canvas', '2026-11-20', names)).toBe('Board')
  })
})
