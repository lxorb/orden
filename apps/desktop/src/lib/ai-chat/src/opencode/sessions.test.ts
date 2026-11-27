import { expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const { openCodeSessions } = await import('./sessions.svelte')
test('a chat from before the OpenCode switch, with no session, is an earlier chat; one answered by OpenCode is not (#2470)', () => {
  const since = openCodeSessions.since()
  expect(openCodeSessions.since()).toBe(since)
  expect(openCodeSessions.earlier({ id: 'old', updated: since - 1000 })).toBe(true)
  openCodeSessions.set('kept', 'ses_1')
  expect(openCodeSessions.of('kept')).toBe('ses_1')
  expect(openCodeSessions.earlier({ id: 'kept', updated: since - 1000 })).toBe(false)
  expect(openCodeSessions.earlier({ id: 'new', updated: since + 1000 })).toBe(false)
  expect(JSON.parse(localStorage.getItem('orden:opencode-sessions') ?? '{}')).toEqual({ kept: 'ses_1' })
})
