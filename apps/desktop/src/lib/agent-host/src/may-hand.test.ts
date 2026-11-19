import { describe, expect, test, vi } from 'vitest'

const locked = new Set(['/s/A/Secret.md'])
const { protection } = await import('../../protect/src/api')
vi.spyOn(protection, 'agentsMay').mockImplementation((path) => !locked.has(path ?? ''))
const { answerTheCrate } = await import('./crate')
describe('the crate asks whether an agent may hand a file to a page', () => {
  test('a file behind a lock shut to agents is refused', async () => {
    expect(await answerTheCrate('agent.may_hand', { path: '/s/A/Secret.md' })).toBe(false)
  })
  test('an open file may go', async () => {
    expect(await answerTheCrate('agent.may_hand', { path: '/s/A/Plan.md' })).toBe(true)
  })
  test('an ask without a path is refused', async () => {
    expect(await answerTheCrate('agent.may_hand', {})).toBe(false)
  })
})
