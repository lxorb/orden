import { expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

test('what was learnt of a model on an account the vault moved stays with it, after a launch too', async () => {
  const { learn, learnt } = await import('./learned')
  learn('compatible-1', 'qwen3', { tools: false })
  const { keepMoves } = await import('../../../ai-providers/src/api')
  keepMoves({ 'compatible-1': 'compatible-2' })
  learn('compatible-1', 'qwen3', { reasons: false })

  expect(learnt('compatible-2', 'qwen3')).toEqual({ tools: false })
  expect(learnt('compatible-1', 'qwen3')).toEqual({ reasons: false })
  vi.resetModules()
  const again = await import('./learned')
  expect(again.learnt('compatible-2', 'qwen3')).toEqual({ tools: false })
  expect(again.learnt('compatible-1', 'qwen3')).toEqual({ reasons: false })
})
