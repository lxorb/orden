import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

const opened = vi.hoisted(() => [] as { owner: string | null; server: boolean }[])

vi.mock('./time.svelte', () => ({
  time: {
    opened: (how: { owner: string | null; server: unknown }) => {
      opened.push({ owner: how.owner, server: how.server !== null })
      return Promise.resolve()
    },
    exchange: () => Promise.resolve(),
  },
}))
vi.mock('./sense.svelte', () => ({}))
vi.mock('./reminding', () => ({}))

localStorage.setItem('orden:session-owner', 'u_ana')
const { account } = await import('../accounts/src/account.svelte')
await import('./start.svelte')

test('started offline while signed in, the account’s own time records open, not the signed-out ones', () => {
  account.token = 'the session'
  flushSync()
  expect(opened.at(-1)).toEqual({ owner: 'u_ana', server: true })

  account.token = null
  flushSync()
  expect(opened.at(-1)).toEqual({ owner: null, server: false })
})
