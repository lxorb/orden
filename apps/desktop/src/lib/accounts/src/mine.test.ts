import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AccountDouble } from '../test/fakes'

vi.mock('./account.svelte', async () => ({
  account: (await import('../test/fakes')).accountDouble(),
}))

const server = vi.hoisted(() => ({ held: null as Promise<void> | null }))

vi.mock('./calls', () => ({
  saveProfile: async (_token: string, changes: Record<string, unknown>) => {
    await server.held
    return changes
  },
  saveNick: async (_token: string, _space: string, nick: string) => {
    await server.held
    return nick
  },
  saveAvatar: () => Promise.resolve({}),
  dropAvatar: () => Promise.resolve({ avatar: null }),
}))

const { changeProfile, nameIn } = await import('./mine')
const account = (await import('./account.svelte')).account as unknown as AccountDouble

function hold(): () => void {
  let free: () => void = () => undefined
  server.held = new Promise((resolve) => (free = resolve))
  return free
}

beforeEach(() => {
  server.held = null
  account.signInAs('a')
})

describe('what this account says of itself', () => {
  test('is worn the moment the account takes it', async () => {
    await changeProfile({ pronouns: 'she/her' })
    expect(account.user?.pronouns).toBe('she/her')
  })

  test('is never worn by the next account when the last one asked', async () => {
    const free = hold()
    const changing = changeProfile({ pronouns: 'she/her' })

    account.signInAs('b')
    free()
    await changing

    expect(account.user?.id).toBe('b')
    expect(account.user?.pronouns).toBeUndefined()
  })

  test('as a name in a space is never worn by the next account when the last one asked', async () => {
    const free = hold()
    const naming = nameIn('space-1', 'Ada')

    account.signInAs('b')
    free()
    await naming

    expect(account.user?.nicks).toBeUndefined()
  })
})
