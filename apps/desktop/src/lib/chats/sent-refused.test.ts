import { expect, test, vi } from 'vitest'

const answer = vi.hoisted(() => ({ refusal: new Error('not yet') }))

vi.mock('../account.svelte', () => ({ account: { token: 'session' } }))

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  request: () => Promise.reject(answer.refusal),
}))

const { ApiError } = await import('../api')
const { sendEvents } = await import('./http')

const CHAT = `c_${'1'.repeat(32)}`

async function sentWhen(refusal: Error) {
  answer.refusal = refusal
  return await sendEvents(CHAT, [])
}

test('a chat the account says is not there takes the messages as gone', async () => {
  expect(await sentWhen(new ApiError(404, 'no such chat', { error: 'no such chat' }))).toBe('gone')
})

test('a refusal from something in the way keeps the messages to send again', async () => {
  expect(await sentWhen(new ApiError(403, 'Forbidden', '<html>blocked</html>'))).toBeNull()
  expect(await sentWhen(new ApiError(404, 'Not Found', null))).toBeNull()
})

test('a session the account no longer knows keeps the messages to send again', async () => {
  expect(await sentWhen(new ApiError(401, 'signed out', { error: 'sign in first' }))).toBeNull()
})

test('a failed connection keeps the messages to send again', async () => {
  expect(await sentWhen(new TypeError('Failed to fetch'))).toBeNull()
})
