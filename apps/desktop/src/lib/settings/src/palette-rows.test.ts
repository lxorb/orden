import { describe, expect, test } from 'vitest'
import type { Pane } from './fields'
import { settingRows } from './palette-rows'

let size = 16
let focus = false
let mode = 'dark'

const PANES: Pane[] = [
  {
    id: 'editor',
    label: 'Editor',
    groups: [
      {
        title: 'Text',
        fields: [
          {
            kind: 'slider',
            hint: '',
            label: 'Text size',
            words: ['font'],
            min: 12,
            max: 24,
            step: 1,
            unit: 'px',
            get: () => size,
            set: (to) => (size = to),
          },
          {
            kind: 'switch',
            hint: '',
            label: 'Focus mode',
            get: () => focus,
            set: (to) => (focus = to),
          },
        ],
      },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    groups: [
      {
        title: 'Theme',
        fields: [
          {
            kind: 'segmented',
            hint: '',
            label: 'Mode',
            options: [
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ],
            get: () => mode,
            set: (to) => (mode = to),
          },
        ],
      },
    ],
  },
]

const rows = settingRows(
  [
    { id: 'editor', label: 'Editor' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'account', label: 'Account' },
  ],
  PANES,
  [{ section: 'account', label: 'Display name', text: [] }],
  'Settings',
)

describe('every setting as a row', () => {
  test('is each pane, each field and each hand-written row, saying where it is', () => {
    expect(rows.map((one) => `${one.label} (${one.where})`)).toEqual([
      'Editor (Settings)',
      'Appearance (Settings)',
      'Account (Settings)',
      'Text size (Editor)',
      'Focus mode (Editor)',
      'Mode (Appearance)',
      'Display name (Account)',
    ])
  })

  test('goes by its choices and its other words, and is found by its group', () => {
    const one = (label: string) => rows.find((row) => row.label === label)
    expect(one('Text size')?.names).toEqual(['font'])
    expect(one('Text size')?.words).toEqual(['Text'])
    expect(one('Mode')?.names).toEqual(['Light', 'Dark'])
  })

  test('knows a pane from a row of one', () => {
    expect(rows.filter((one) => !one.row).map((one) => one.label)).toEqual([
      'Editor',
      'Appearance',
      'Account',
    ])
  })
})

describe('what a setting says it is set to', () => {
  const row = (label: string) => rows.find((one) => one.label === label)

  test('is the choice by name, and a number with its unit', () => {
    expect(row('Mode')?.value()).toBe('Dark')
    expect(row('Text size')?.value()).toBe('16px')
  })

  test('is nothing for a switch, which draws its own, or a row with no control', () => {
    expect(row('Focus mode')?.value()).toBeNull()
    expect(row('Focus mode')?.switched()).toBe(false)
    expect(row('Display name')?.value()).toBeNull()
    expect(row('Display name')?.switched()).toBeNull()
  })

  test('is flipped where it stands for a switch, and nothing to press on a row with no control', () => {
    row('Focus mode')?.press?.()
    expect(focus).toBe(true)
    expect(row('Text size')?.press).toBeNull()
  })
})
