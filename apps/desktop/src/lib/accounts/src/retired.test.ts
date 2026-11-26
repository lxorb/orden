// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from 'vitest'
import { forgetRetiredChats, type RetiredWorld, retiredSecrets, secretName } from './retired'

const LINKED = [
  { provider: 'gmail', account: 'Emil@Example.org', config: { address: 'Emil@Example.org' } },
  { provider: 'whatsapp', account: '41790000001', config: {} },
]
function world() {
  const forgot: string[] = []
  const dropped: string[] = []
  let asked = 0
  const said: RetiredWorld = {
    forgetSecret: (name) => {
      forgot.push(name)
      return Promise.resolve()
    },
    sealedNames: () => {
      asked++
      return Promise.resolve(['wa-auth-41790000001', 'tg-session'])
    },
    dropDatabase: (name) => {
      dropped.push(name)
      return Promise.resolve()
    },
  }
  return { said, forgot, dropped, asked: () => asked }
}
beforeEach(() => localStorage.clear())
describe('a secret name of a chat service gone', () => {
  test('is one the vault took, and differs per account', () => {
    const one = secretName('mail', 'emil@example.org', 'password')
    const two = secretName('mail', 'lucile@example.org', 'password')
    for (const name of [one, two, secretName('a'.repeat(90), 'x'.repeat(500), 'f'.repeat(90))])
      expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(one).not.toBe(two)
    expect(one.startsWith('chat-mail_')).toBe(true)
  })
  test("covers every linked account's fields, as written and lowered, and every sealed key", () => {
    localStorage.setItem('orden:chat-accounts', JSON.stringify(LINKED))
    const names = retiredSecrets(['tg-session'])
    expect(names).toContain(secretName('gmail', 'emil@example.org', 'refresh'))
    expect(names).toContain(secretName('gmail', 'Emil@Example.org', 'clientSecret'))
    expect(names).toContain(secretName('whatsapp', '41790000001', 'session'))
    expect(names).toContain(secretName('sealed', 'tg-session', 'key'))
    expect(new Set(names).size).toBe(names.length)
  })
})
describe('an update on a device with linked chat accounts', () => {
  test('forgets their secrets and stores and the list, and never comes back for more', async () => {
    localStorage.setItem('orden:chat-accounts', JSON.stringify(LINKED))
    const { said, forgot, dropped, asked } = world()
    await forgetRetiredChats(said)
    expect(forgot).toContain(secretName('whatsapp', '41790000001', 'token'))
    expect(forgot).toContain(secretName('sealed', 'wa-auth-41790000001', 'key'))
    expect(dropped).toEqual(['orden-chat-sealed', 'orden-signal'])
    expect(localStorage.getItem('orden:chat-accounts')).toBeNull()
    await forgetRetiredChats(said)
    expect(asked()).toBe(1)
  })
  test('with nothing linked asks the vault for nothing', async () => {
    const { said, forgot } = world()
    said.sealedNames = () => Promise.resolve([])
    await forgetRetiredChats(said)
    expect(forgot).toEqual([])
  })
})
