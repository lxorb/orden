import { describe, expect, test, vi } from 'vitest'

vi.mock('../../platform/src/api', () => ({ AGENTS_NAME: 'AGENTS.md' }))
const { AGENTS_SEED, isUntouchedAgents } = await import('../src/api')
describe('the AGENTS.md a new space starts with', () => {
  test('asks to be written to in the notes own style and before anything is deleted', () => {
    expect(AGENTS_SEED.startsWith('# AGENTS\n')).toBe(true)
    expect(AGENTS_SEED).toContain('ask before deleting')
  })
  test('is untouched only word for word and under its own name', () => {
    expect(isUntouchedAgents('/spaces/Journal/AGENTS.md', AGENTS_SEED)).toBe(true)
    expect(isUntouchedAgents('C:\\spaces\\Journal\\AGENTS.md', AGENTS_SEED)).toBe(true)
    expect(isUntouchedAgents('/spaces/Journal/AGENTS.md', `${AGENTS_SEED}- tea\n`)).toBe(false)
    expect(isUntouchedAgents('/spaces/Journal/Other.md', AGENTS_SEED)).toBe(false)
  })
})
