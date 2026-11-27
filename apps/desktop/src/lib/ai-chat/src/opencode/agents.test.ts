import { expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

vi.mock('../../../opencode-client/src/api', () => ({
  opencode: {
    agents: () =>
      Promise.resolve([
        { name: 'build', mode: 'primary', description: 'Builds' },
        { name: 'general', mode: 'subagent' },
        { name: 'notes', mode: 'all', description: 'Tidies notes' },
        { name: 'summary', mode: 'primary', hidden: true },
      ]),
  },
}))
const { openCodeAgents, agentName } = await import('./agents.svelte')
test('a chat answers with Build until another agent is chosen for it, and the choice is kept (#2470)', () => {
  expect(openCodeAgents.of('c1')).toBe('build')
  openCodeAgents.choose('c1', 'plan')
  expect(openCodeAgents.of('c1')).toBe('plan')
  expect(openCodeAgents.of('c2')).toBe('build')
  expect(JSON.parse(localStorage.getItem('orden:opencode-agents') ?? '{}')).toEqual({ c1: 'plan' })
  expect(agentName('plan')).toBe('Plan')
})
test('the agents offered are OpenCode’s primary ones, without helpers or hidden ones (#2470)', async () => {
  expect(openCodeAgents.rows.map((one) => one.name)).toEqual(['build', 'plan'])
  await openCodeAgents.load()
  expect(openCodeAgents.rows).toEqual([
    { name: 'build', description: 'Builds' },
    { name: 'notes', description: 'Tidies notes' },
  ])
})
