import { describe, expect, test } from 'vitest'
import type { Thread } from '../../../ai-providers/src/api'
import { allows, keptUnder } from './reach'
import { newThread } from './threads'

const thread = (more: Partial<Thread> = {}): Thread => ({ ...newThread('Notes', 'p', 'm', 'auto', 'full'), ...more })
describe('what a thread may use', () => {
  test('is everything not kept out, or only what it is given', () => {
    expect(allows(thread(), 'run_terminal')).toBe(true)
    expect(allows(thread({ without: ['run_terminal'] }), 'run_terminal')).toBe(false)
    expect(allows(thread({ only: ['read_note'] }), 'run_terminal')).toBe(false)
    expect(allows(thread({ only: ['read_note'], without: ['read_note'] }), 'read_note')).toBe(false)
    expect(allows(thread({ only: [] }), 'read_note')).toBe(false)
  })
})
describe('a thread started under another', () => {
  test('keeps out what either keeps out, uses only what both may, and works in no wider a mode', () => {
    const parent = thread({ mode: 'auto', without: ['browser_open'], only: ['read_note', 'edit_note'] })
    const child = thread({ mode: 'full', without: ['edit_note'], only: ['edit_note', 'run_terminal'] })
    keptUnder(parent, child)
    expect(child).toMatchObject({ mode: 'auto', without: ['browser_open', 'edit_note'], only: ['edit_note'] })
    const free = thread({ mode: 'plan' })
    keptUnder(thread({ mode: 'approve', only: [] }), free)
    expect(free).toMatchObject({ mode: 'approve', only: [] })
    const open = thread({ mode: 'plan' })
    keptUnder(thread({ mode: 'full' }), open)
    expect(open.mode).toBe('plan')
    expect(open).not.toHaveProperty('only')
    expect(open).not.toHaveProperty('without')
  })
})
