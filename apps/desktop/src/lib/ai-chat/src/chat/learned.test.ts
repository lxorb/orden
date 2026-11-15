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

test('what was learnt and how far it followed the moves are kept as one, so neither is kept without the other', async () => {
  vi.resetModules()
  localStorage.clear()
  const { learn } = await import('./learned')
  const { keepMoves } = await import('../../../ai-providers/src/api')
  learn('anthropic', 'opus', { tools: false })
  keepMoves({ anthropic: 'anthropic-2' })
  const written: string[] = []
  const write = localStorage.setItem.bind(localStorage)
  vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
    written.push(key)
    write(key, value)
  })

  learn('anthropic', 'opus', { reasons: false })

  vi.restoreAllMocks()
  expect(written).toEqual(['orden:ai-chat'])
  vi.resetModules()
  const again = await import('./learned')
  expect(again.learnt('anthropic', 'opus')).toEqual({ reasons: false })
  expect(again.learnt('anthropic-2', 'opus')).toEqual({ tools: false })
})
