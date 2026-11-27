import { expect, test, vi } from 'vitest'

const replied = vi.hoisted(() => [] as unknown[][])
const invoked = vi.hoisted(() => [] as unknown[][])
vi.mock('../../../opencode-client/src/api', () => ({
  opencode: { reply: (...args: unknown[]) => (replied.push(args), Promise.resolve(true)) },
}))
vi.mock('../../../platform/src/api', async (actual) => ({
  ...(await actual<typeof import('../../../platform/src/api')>()),
  invoke: (...args: unknown[]) => (invoked.push(args), Promise.resolve()),
}))
const { crateAnswers } = await import('./approvals')
test('a permission OpenCode asked is answered to OpenCode: once, always or a refusal (#2470)', async () => {
  await crateAnswers.answer('per_1', true)
  await crateAnswers.answer('per_2', true, true)
  await crateAnswers.answer('per_3', false)
  expect(replied).toEqual([
    ['per_1', 'once'],
    ['per_2', 'always'],
    ['per_3', 'reject'],
  ])
  expect(invoked).toEqual([])
})
test('Orden’s own approvals still go to the app', async () => {
  await crateAnswers.answer('q7', true, true)
  expect(invoked).toEqual([['agents_answer', { id: 'q7', allow: true, always: false }]])
})
