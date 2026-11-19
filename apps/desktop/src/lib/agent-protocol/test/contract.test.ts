import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { ACTIVE_FOR, AGENT_WINDOW_VERBS, BROWSER_VERBS, CAPTURE_AS, CRATE_ASKS } from '../src/api'

const SRC = join(import.meta.dirname, '../src')
describe('the module stands on its own', () => {
  test('reaches no other file of the app, only the contracts', () => {
    const reached = readdirSync(SRC)
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
      .flatMap((name) =>
        [...readFileSync(join(SRC, name), 'utf8').matchAll(/from '([^']*)'/g)].map((found) => found[1]),
      )
    expect([...new Set(reached)].sort()).toEqual(['./verbs', '@orden/contracts'])
  })
})
describe('what an agent may do', () => {
  test('every window verb names the scope it needs, or none', () => {
    expect(AGENT_WINDOW_VERBS.list_notes).toBe('notes.read')
    expect(AGENT_WINDOW_VERBS.list_spaces).toBeNull()
  })
  test('no window verb is also a browser verb', () => {
    const browser = new Set<string>(BROWSER_VERBS)
    expect(Object.keys(AGENT_WINDOW_VERBS).filter((one) => browser.has(one))).toEqual([])
  })
  test('a page is captured as a clip, a screenshot or a pdf', () => {
    expect([...CAPTURE_AS]).toEqual(['clip', 'screenshot', 'pdf'])
  })
  test('the crate asks under the agent namespace, and a touch counts as acting for a while', () => {
    expect(Object.values(CRATE_ASKS).every((one) => one.startsWith('agent.'))).toBe(true)
    expect(ACTIVE_FOR).toBeGreaterThan(0)
  })
})
