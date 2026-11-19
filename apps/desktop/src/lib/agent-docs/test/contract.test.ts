import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { DocError, inTurn, plan, readEdits, revOf, touchedBy } from '../src/api'

const followed = vi.hoisted(() => [] as unknown[])
vi.mock('../../workspace/src/api', () => ({
  workspace: { fileOps: { follow: (one: unknown) => followed.push(one) } },
}))
const HERE = join(import.meta.dirname, '..')
const SRC = join(HERE, 'src')
describe('the module stands on its own', () => {
  test('the note docs open through a door', () => {
    const api = readFileSync(join(SRC, 'api.ts'), 'utf8')
    expect(api).toMatch(/import\('\.\/index'\)/)
    expect(api).not.toMatch(/from '\.\/index'/)
  })
  test('the api loads without the note docs, which follow file moves only once opened', () => {
    expect(followed).toEqual([])
  })
})
describe('a note an agent reads', () => {
  test('has one revision for the same words and another for other words', () => {
    expect(revOf('plan')).toBe(revOf('plan'))
    expect(revOf('plan')).not.toBe(revOf('plans'))
  })
  test('was touched by nobody while no agent wrote to it', () => {
    expect(touchedBy('notes/a.md')).toEqual([])
    expect(touchedBy(null)).toEqual([])
  })
})
describe('turns', () => {
  test('runs taken under one key wait for each other, even past a failure', async () => {
    const order: string[] = []
    const first = inTurn('a.md', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('first')
      throw new Error('refused')
    })
    const second = inTurn('a.md', async () => {
      order.push('second')
      return 2
    })
    await expect(first).rejects.toThrow('refused')
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(['first', 'second'])
  })
})
describe('the edits an agent asks for', () => {
  test('are read from the wire and placed in the words they name', () => {
    const text = 'The plan is simple.'
    const planned = plan(readEdits([{ at: { quote: 'simple' }, replace: 'late' }]), text)
    expect(planned.edits).toEqual([{ from: 12, to: 18, insert: 'late' }])
  })
  test('are refused with a doc error when they do not say one thing', () => {
    expect(() => readEdits([])).toThrow(DocError)
    expect(() => readEdits([{ at: { end: true } }])).toThrow(DocError)
  })
  test('are refused when two change the same words', () => {
    const asked = readEdits([
      { at: { quote: 'plan' }, replace: 'idea' },
      { at: { quote: 'plan is' }, replace: 'goal was' },
    ])
    expect(() => plan(asked, 'The plan is simple.')).toThrow(DocError)
  })
})
