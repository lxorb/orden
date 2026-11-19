import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { BY_ID, BORROWED_KEYS } from './registry'

const LISTS = [
  { list: 'todos', dir: join(import.meta.dirname, '../../tasks-views/src'), thing: /\btodos?\b/i },
] as const
const asked = (dir: string): string[] => [
  ...new Set(
    readdirSync(dir)
      .filter((name) => /\.(ts|svelte)$/.test(name) && !name.includes('.test.'))
      .flatMap((name) => [
        ...readFileSync(join(dir, name), 'utf8').matchAll(/shortcuts\.(?:pressed|hint)\('([\w.-]+)'/g),
      ])
      .map((found) => found[1] ?? ''),
  ),
]
describe.each(LISTS)('the keys the $list list borrows from the file tree', ({ list, dir, thing }) => {
  test('are each found by the scan', () => {
    expect(asked(dir).length).toBeGreaterThan(5)
  })
  test('count the list as a place they answer in', () => {
    const borrowed = BORROWED_KEYS[list]
    const missing = asked(dir).filter((id) => !borrowed?.has(id))
    expect(missing, `${list} answers to these without saying so`).toEqual([])
  })
  test('are named for what they act on there as well as in the tree', () => {
    const fileOnly = [...(BORROWED_KEYS[list] ?? [])]
      .map((id) => ({ id, label: BY_ID.get(id)?.label() ?? '' }))
      .filter((one) => /\bfiles?\b/i.test(one.label) && !thing.test(one.label))
      .map((one) => `${one.id}: ${one.label}`)
    expect(fileOnly, `these say files where they act on ${list} too`).toEqual([])
  })
})
