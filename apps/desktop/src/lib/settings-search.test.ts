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
          { kind: 'switch', label: 'Save as I type', get: () => true, set: () => undefined },
          {
            kind: 'slider',
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
    ],
  },
]

const places: Place[] = [
  { section: 'account', label: 'Storage', text: ['used', 'limit'] },
  { section: 'export', label: 'Export as PDF', text: [] },
]

const labels = (query: string) =>
  search(query, panes, places).map((hit) => (hit.kind === 'field' ? hit.field.label : hit.label))

describe('searching the settings', () => {
  test('finds a field by its own name', () => {
    expect(labels('wait')).toEqual(['Wait before saving'])
  })

  test('finds every field in a group by the group name', () => {
    expect(labels('saving')).toEqual(['Save as I type', 'Wait before saving'])
  })

  test('finds a field by the pane it lives in', () => {
    expect(labels('general')).toHaveLength(3)
  })

  test('finds a dropdown by one of its choices', () => {
    expect(labels('deutsch')).toEqual(['Language'])
  })

  test('finds a slider by its unit', () => {
    expect(labels('ms')).toEqual(['Wait before saving'])
  })

  test('finds a place in a hand-written pane by any word on it', () => {
    expect(labels('limit')).toEqual(['Storage'])
    expect(labels('pdf')).toEqual(['Export as PDF'])
  })

  test('ignores case and surrounding space', () => {
    expect(labels('  DEUTSCH ')).toEqual(['Language'])
  })

  test('finds nothing for nothing', () => {
    expect(labels('')).toEqual([])
    expect(labels('   ')).toEqual([])
  })

  test('says which pane a hit belongs to', () => {
    const [hit] = search('pdf', panes, places)
    expect(hit.kind === 'place' && hit.section).toBe('export')

    const [field] = search('wait', panes, places)
    expect(field.kind === 'field' && field.pane.id).toBe('general')
  })
})
