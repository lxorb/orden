import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

const opened = vi.hoisted(() => [] as { owner: string | null; server: boolean }[])

vi.mock('./account.svelte', () => ({
  accountInbox: {
    opened: (how: { owner: string | null; server: unknown }) => {
      opened.push({ owner: how.owner, server: how.server !== null })
      return Promise.resolve()
    },
    hear: () => () => undefined,
    exchange: () => Promise.resolve(false),
    text: () => Promise.resolve(''),
  },
}))

localStorage.setItem('orden:session-owner', 'u_ana')
const { account } = await import('../account.svelte')
await import('./start.svelte')

test('started offline while signed in, the account’s own inbox opens, not the signed-out one', () => {
  account.token = 'the session'
  flushSync()
  expect(opened.at(-1)).toEqual({ owner: 'u_ana', server: true })

  account.token = null
  flushSync()
  expect(opened.at(-1)).toEqual({ owner: null, server: false })
})
