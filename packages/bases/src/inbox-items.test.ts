import { describe, expect, test } from 'vitest'
import { changesTo, type Item, readInbox, rendered } from './inbox-items'

let next = 0
const newId = () => `n${(next += 1)}`
const all = () => true

const itemsOf = (markdown: string): Item[] =>
  changesTo([], markdown, newId, all).map(({ id, fields }) => ({ id, fields }))

const applied = (items: readonly Item[], markdown: string, shown = all): Item[] => {
  const out = new Map(items.map((one) => [one.id, { id: one.id, fields: { ...one.fields } }]))
  for (const change of changesTo(items, markdown, newId, shown)) {
    const was = out.get(change.id)
    out.set(change.id, { id: change.id, fields: { ...was?.fields, ...change.fields } })
  }
  return [...out.values()]
}

describe('the inbox written out', () => {
  test('keeps every field of a to-do through records and back, and shows no ids of its own', () => {
    next = 0
    const items = itemsOf(
      [
        'Things to sort',
        '- [ ] Call the bank 📅 2026-11-07 ⏫ 🔁 every week #money',
        '- [x] Water the plants ✅ 2026-11-06',
        '  - [ ] the ferns',
        '  Some words about them',
        '- [-] Old plan ❌ 2026-11-01 ^kept-ref',
      ].join('\n'),
    )
    const out = rendered(items)
    expect(out).toContain('Things to sort\n')
    expect(out).toMatch(/- \[ \] Call the bank .*#money/)
    expect(out).toMatch(/📅 2026-11-07/)
    expect(out).toMatch(/🔁 every week/)
    expect(out).toMatch(/- \[x\] Water the plants .*✅ 2026-11-06\n/)
    expect(out).toContain('\n  - [ ] the ferns\n  Some words about them\n')
    expect(out).toMatch(/- \[-\] Old plan .*❌ 2026-11-01 \^kept-ref/)
    expect(out).not.toMatch(/\^n\d/)
    const again = readInbox(out)
    expect(again.head).toBe('Things to sort')
    expect(again.blocks.map((one) => one.task.text)).toEqual([
      'Call the bank',
      'Water the plants',
      'Old plan',
    ])
    expect(again.blocks[0]?.task.priority).toBe(2)
    expect(changesTo(items, out, newId, all)).toEqual([])
  })

  test('turns an edit into the fields it changed, and a line taken away into a gone to-do', () => {
    next = 0
    const items = itemsOf('- [ ] A\n- [ ] B\n- [ ] C\n')
    const edited = rendered(items)
      .replace('- [ ] A', '- [x] A ✅ 2026-11-07')
      .split('\n')
      .filter((line) => !line.includes('] B'))
      .join('\n')
    const changes = changesTo(items, edited, newId, all)
    expect(changes).toContainEqual({ id: 'n1', fields: { status: 'x', completed: '2026-11-07' } })
    expect(changes).toContainEqual({ id: 'n2', fields: { gone: true } })
    expect(changes).toContainEqual({ id: 'n3', fields: { order: 1 } })
  })

  test('keeps a to-do whose words were changed where it stood', () => {
    next = 0
    const items = itemsOf('- [ ] A\n- [ ] B\n')
    const changes = changesTo(items, '- [ ] A\n- [ ] B, said better\n', newId, all)
    expect(changes).toEqual([{ id: 'n2', fields: { text: 'B, said better' } }])
  })

  test('finds a to-do by its words when lines move around', () => {
    next = 0
    const items = itemsOf('- [ ] A\n- [ ] B\n- [ ] C\n')
    const after = applied(items, '- [x] C\n- [ ] A\n')
    const by = Object.fromEntries(after.map((one) => [one.id, one.fields]))
    expect(by.n3).toMatchObject({ text: 'C', status: 'x', order: 0 })
    expect(by.n1).toMatchObject({ text: 'A', order: 1 })
    expect(by.n2?.gone).toBe(true)
  })

  test('never takes away a to-do the writer was not shown', () => {
    next = 0
    const items = itemsOf('- [ ] A\n- [ ] B\n')
    const changes = changesTo(items, '- [ ] A\n', newId, (id) => id !== 'n2')
    expect(changes).toEqual([])
  })

  test('gives a copied line a to-do of its own', () => {
    next = 0
    const items = itemsOf('- [ ] A\n')
    const changes = changesTo(items, '- [ ] A\n- [ ] A\n', newId, all)
    expect(changes.map((one) => one.id)).toEqual(['n2'])
  })
})
