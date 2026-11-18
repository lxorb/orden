import { beforeEach, expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../../test/disk')

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.resetModules()
})

const moves = () => import('./moves')

test('an account the vault moved keeps the agent rights it had, and its old id starts on rights of its own', async () => {
  const { keepMoves, rightsHolder, rightsKey } = await moves()
  expect(rightsKey('openai')).toBe('openai')
  keepMoves({ openai: 'openai-2' }, 5)
  expect(rightsKey('openai-2')).toBe('openai')
  expect(rightsKey('openai')).not.toBe('openai')
  expect(rightsKey('openai')).toMatch(/^[A-Za-z0-9_-]{1,48}$/)
  expect(rightsKey('codex')).toBe('codex')
  expect(rightsHolder('openai')).toBe('openai-2')
  expect(rightsHolder(rightsKey('openai'))).toBe('openai')
  expect(rightsHolder('codex')).toBe('codex')
})

test('an account moved twice still goes by its first rights, and a move said twice is one move', async () => {
  const { keepMoves, rightsKey } = await moves()
  keepMoves({ openai: 'openai-2' }, 5)
  keepMoves({ openai: 'openai-2' }, 6)
  keepMoves({ 'openai-2': 'openai-3' }, 7)
  expect(rightsKey('openai-3')).toBe('openai')
  expect(rightsKey('openai-2')).not.toBe('openai')
  expect(rightsKey('openai')).not.toBe(rightsKey('openai-2'))
})

test('the rights an account goes by stay the same after a launch', async () => {
  const before = await moves()
  before.keepMoves({ anthropic: 'anthropic-2' }, 9)
  const fresh = before.rightsKey('anthropic')
  vi.resetModules()
  const after = await moves()
  expect(after.rightsKey('anthropic-2')).toBe('anthropic')
  expect(after.rightsKey('anthropic')).toBe(fresh)
})

test('the same move said again by a window that heard of it late is still one move', async () => {
  const { keepMoves, rightsKey } = await moves()
  keepMoves({ openai: 'openai-2' }, 5)
  const first = rightsKey('openai')
  keepMoves({ 'openai-2': 'openai-3' }, 6)
  keepMoves({ openai: 'openai-2' }, 5 + 3_600_000)
  expect(rightsKey('openai-3')).toBe('openai')
  expect(rightsKey('openai')).toBe(first)
})

test('the same move made later for another account is a move of its own', async () => {
  const { keepMoves, movedSince, rightsKey } = await moves()
  keepMoves({ openai: 'openai-2' }, 5, { openai: 'openai||print-1' })
  const first = rightsKey('openai')
  keepMoves({ openai: 'openai-2' }, 7, { openai: 'openai||print-2' })
  keepMoves({ openai: 'openai-2' }, 9, { openai: 'openai||print-2' })
  expect(rightsKey('openai-2')).toBe(first)
  expect(rightsKey('openai')).not.toBe(first)
  expect(rightsKey('openai')).toBe('openai_7')
  expect(movedSince('openai', 6)).toBe('openai-2')
})

test('a move another window kept is told along with this window’s own, so nothing is missed', async () => {
  const { keepMoves, movesAfter, onMoves } = await moves()
  movesAfter(0)
  const heard: string[] = []
  onMoves((told) => heard.push(...told.map((one) => `${one.from}>${one.to}`)))
  localStorage.setItem('orden:ai-moves', JSON.stringify([{ from: 'x', to: 'x-2', at: 5 }]))
  keepMoves({ y: 'y-2' }, 7)
  expect(heard).toEqual(['x>x-2', 'y>y-2'])
})

test('a move another window already kept is not kept again from a copy read before it', async () => {
  const { keepMoves, rightsKey, movesAfter } = await moves()
  movesAfter(0)
  localStorage.setItem(
    'orden:ai-moves',
    JSON.stringify([{ from: 'openai', to: 'openai-2', at: 5 }]),
  )
  keepMoves({ openai: 'openai-2' }, 7)
  expect(movesAfter(0)).toEqual([{ from: 'openai', to: 'openai-2', at: 5 }])
  expect(rightsKey('openai')).toBe('openai_5')
})

test('moves kept where web storage cannot be written are still known to the window', async () => {
  vi.stubGlobal('localStorage', undefined)
  const { keepMoves, movedSince, rightsKey } = await moves()
  keepMoves({ openai: 'openai-2' }, 5)
  keepMoves({ anthropic: 'anthropic-2' }, 6)
  expect(movedSince('openai', 0)).toBe('openai-2')
  expect(rightsKey('openai-2')).toBe('openai')
  expect(rightsKey('anthropic-2')).toBe('anthropic')
})
