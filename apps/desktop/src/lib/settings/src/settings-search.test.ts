import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import type { Pane } from './preferences'
import { type Place, search } from './settings-search'

const panes: Pane[] = [
  {
    id: 'general',
    label: 'General',
    groups: [
      {
        title: 'Saving',
        fields: [
          {
            kind: 'switch',
            hint: '',
            label: 'Save as I type',
            get: () => true,
            set: () => undefined,
          },
          {
            kind: 'slider',
            hint: '',
            label: 'Wait before saving',
            min: 0,
            max: 10,
            step: 1,
            unit: 'ms',
            get: () => 1,
            set: () => undefined,
          },
        ],
      },
      {
        title: 'Language',
        fields: [
          {
            kind: 'select',
            hint: '',
            label: 'Language',
            options: [
              { value: 'en', label: 'English' },
              { value: 'de', label: 'Deutsch' },
            ],
            get: () => 'en',
            set: () => undefined,
          },
        ],
      },
      {
        title: 'Appearance',
        fields: [
          {
            kind: 'switch',
            label: 'Strict CommonMark',
            hint: 'Only the standard rules, no tables or footnotes.',
            get: () => false,
            set: () => undefined,
          },
          {
            kind: 'segmented',
            hint: '',
            label: 'Mode',
            options: [
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Nocturne' },
            ],
            get: () => 'system',
            set: () => undefined,
          },
        ],
      },
    ],
  },
]
const places: Place[] = [
  { section: 'account', label: 'Storage', text: ['used', 'limit'] },
  { section: 'terminal', label: 'Add host', text: ['SSH'] },
]
const labels = (query: string) =>
  search(query, panes, places).map((hit) => (hit.kind === 'field' ? hit.field.label : hit.label))
describe('searching the settings', () => {
  test.each([
    ['wait', ['Wait before saving']],
    ['saving', ['Save as I type', 'Wait before saving']],
    ['deutsch', ['Language']],
    ['ms', ['Wait before saving']],
    ['nocturne', ['Mode']],
    ['footnotes', ['Strict CommonMark']],
    ['limit', ['Storage']],
    ['ssh', ['Add host']],
    ['  DEUTSCH ', ['Language']],
    ['', []],
    ['   ', []],
  ])('finds %j by name, group, choice, unit, explanation or a word on a hand-written pane', (query, found) => {
    expect(labels(query)).toEqual(found)
  })
  test('finds a field by the pane it lives in, and says which pane a hit belongs to', () => {
    expect(labels('general')).toHaveLength(5)
    const [hit] = search('ssh', panes, places)
    expect(hit?.kind === 'place' ? hit.section : null).toBe('terminal')
    const [field] = search('wait', panes, places)
    expect(field?.kind === 'field' ? field.pane.id : null).toBe('general')
  })
})
describe('the hand-written panes the search knows about', () => {
  const source = readFileSync(join(import.meta.dirname, './places.ts'), 'utf8')
  test('name the rescue that takes a space back, while how long versions are kept is a field under General', () => {
    expect(source).not.toContain("label: 'History on the account'")
    expect(source).toContain("label: 'Go back'")
  })
})
