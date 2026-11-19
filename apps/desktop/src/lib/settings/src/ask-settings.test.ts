import { describe, expect, test } from 'vitest'
import { answerOf, apply, brief, offers } from './ask-settings'
import type { Field, Pane } from './fields'

function world() {
  const held = { spell: true, theme: 'light', size: 16, name: 'Mine', locked: false }
  const fields: Field[] = [
    {
      kind: 'switch',
      label: 'Check spelling',
      hint: '',
      get: () => held.spell,
      set: (on) => (held.spell = on),
    },
    {
      kind: 'select',
      label: 'Theme',
      hint: '',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ],
      get: () => held.theme,
      set: (value) => (held.theme = value),
    },
    {
      kind: 'slider',
      label: 'Text size',
      hint: '',
      min: 12,
      max: 24,
      step: 2,
      unit: 'px',
      get: () => held.size,
      set: (value) => (held.size = value),
    },
    {
      kind: 'text',
      label: 'Device name',
      hint: '',
      placeholder: '',
      get: () => held.name,
      set: (value) => (held.name = value),
    },
    {
      kind: 'switch',
      label: 'Held by the school',
      hint: '',
      locked: () => true,
      get: () => held.locked,
      set: (on) => (held.locked = on),
    },
  ]
  const panes: Pane[] = [{ id: 'general', label: 'General', groups: [{ title: 'Writing', fields }] }]
  const places = [{ section: 'account' as const, label: 'Email', text: ['me@example.com'] }]
  const all = offers(panes, places, (section) => (section === 'account' ? 'Account' : ''))
  return { held, all }
}

describe('the settings an agent is told about', () => {
  test('name where each one is, what it holds, and what it may become, and no more', () => {
    const { all } = world()
    const told = brief(all)
    expect(told).toContain('s1 | General > Writing > Check spelling | switch | On | true, false')
    expect(told).toContain('s2 | General > Writing > Theme | choice | Light | light (Light), dark (Dark)')
    expect(told).toContain('s3 | General > Writing > Text size | slider | 16px | 12 to 24 by 2')
    expect(told).toContain('s4 | General > Writing > Device name | where only')
    expect(told).toContain('s5 | General > Writing > Held by the school | where only')
    expect(told).toContain('s6 | Account > Email | where only')
    expect(told).not.toContain('Mine')
    expect(told).not.toContain('me@example.com')
  })
})

describe("an agent's answer", () => {
  test('shows the settings it names and offers each change it asks for, making none of them', () => {
    const { held, all } = world()
    const answer = answerOf(
      'Sure: {"say": "Theme is in General.", "show": ["s2", "s2", "s9"], "change": [{"id": "s2", "to": "dark"}, {"id": "s1", "to": false}]}',
      all,
    )
    expect(answer.say).toBe('Theme is in General.')
    expect(answer.show.map((one) => one.label)).toEqual(['Theme'])
    expect(answer.changes.map((one) => [one.offer.label, one.from, one.shown])).toEqual([
      ['Theme', 'Light', 'Dark'],
      ['Check spelling', 'On', 'Off'],
    ])
    expect(held).toMatchObject({ theme: 'light', spell: true })
    for (const change of answer.changes) expect(apply(change)).toBe(true)
    expect(held).toMatchObject({ theme: 'dark', spell: false })
  })

  test('drops a change to a value not offered, a field that only says where it is, a locked one, or one already so', () => {
    const { held, all } = world()
    const answer = answerOf(
      JSON.stringify({
        say: 'Done',
        show: [],
        change: [
          { id: 's2', to: 'purple' },
          { id: 's1', to: 'no' },
          { id: 's4', to: 'Hacked' },
          { id: 's5', to: true },
          { id: 's6', to: 'x' },
          { id: 's3', to: 30 },
          { id: 's2', to: 'light' },
          { id: 's3', to: 19 },
        ],
      }),
      all,
    )
    expect(answer.changes.map((one) => [one.offer.label, one.to])).toEqual([['Text size', 20]])
    expect(held).toMatchObject({ name: 'Mine', locked: false, theme: 'light' })
  })

  test('that is not JSON is refused', () => {
    const { all } = world()
    expect(() => answerOf('I cannot help with that', all)).toThrow()
  })
})
