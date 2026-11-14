import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { type TestEnv, testEnv } from '../../sync-server/test/fakes'
import {
  accountById,
  presentUser,
  requireWhoever,
  sendCode,
  sessionFor,
  signingIn,
  verifyCode,
} from '../src/auth'
import { asksForSecond, base32, codeAt, matches, newSecret, recoveryCodes } from '../src/second'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
  vi.restoreAllMocks()
})

async function codeSentTo(address: string): Promise<string> {
  const logged: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((message) => {
    logged.push(String(message))
  })
  const sent = await sendCode(env, address)
  spy.mockRestore()
  expect(sent).toMatchObject({ ok: true })
  const code = /(\d{3}) (\d{3})/.exec(logged.join('\n'))
  if (!code) throw new Error(`no code was sent:\n${logged.join('\n')}`)
  return `${code[1]}${code[2]}`
}

describe('signing in with a code', () => {
  test('a mailed code opens the account once, and a wrong or spent code is refused', async () => {
    const code = await codeSentTo('a@b.dev')

    const wrong = await verifyCode(env, 'a@b.dev', code === '000000' ? '000001' : '000000')
    expect(wrong).toMatchObject({ status: 400 })

    const verified = await verifyCode(env, 'a@b.dev', code)
    if ('error' in verified) throw new Error(verified.error)
    expect(verified.user.email).toBe('a@b.dev')
    expect(await accountById(env, verified.user.id)).toMatchObject({ email: 'a@b.dev' })

    expect(await verifyCode(env, 'a@b.dev', code)).toMatchObject({ status: 400 })
  })

  test('an address that is not an email gets no code', async () => {
    expect(await sendCode(env, 'nobody')).toMatchObject({ status: 400 })
  })

  test('asking twice straight away sends nothing new and says when to ask again', async () => {
    await codeSentTo('again@b.dev')
    const again = await sendCode(env, 'again@b.dev')
    expect(again).toMatchObject({ ok: true })
    if (!('ok' in again)) throw new Error('refused')
    expect(again.resendIn).toBeGreaterThan(0)
  })
})

describe('sessions', () => {
  test('a session token names its user, and anything else is nobody', async () => {
    const signing = await signingIn(env, 'c@b.dev')
    if ('second' in signing) throw new Error('a new account asks for no second factor')
    const session = await sessionFor(env, signing.user, 'laptop')
    expect(session.user).toEqual(presentUser(signing.user))
    expect(session.user).not.toHaveProperty('created_at')

    const who = await requireWhoever(env, `Bearer ${session.token}`)
    expect(who).toEqual({ kind: 'user', user: signing.user })

    expect(await requireWhoever(env, undefined)).toBeNull()
    expect(await requireWhoever(env, 'Bearer not-a-token')).toBeNull()
    expect(await requireWhoever(env, session.token)).toBeNull()
  })

  test('signing in with the same address twice is the same account', async () => {
    const first = await signingIn(env, 'd@b.dev')
    const second = await signingIn(env, 'd@b.dev')
    if ('second' in first || 'second' in second) throw new Error('unexpected second factor')
    expect(second.user.id).toBe(first.user.id)
    expect(await asksForSecond(env, first.user.id)).toBe(false)
  })
})

describe('the second factor', () => {
  test('a secret gives six digit codes that match within a step', async () => {
    const secret = newSecret()
    const step = Math.floor(Date.now() / 30_000)
    const code = await codeAt(secret, step)
    expect(code).toMatch(/^\d{6}$/)
    expect(await matches(secret, code)).toBe(true)
    expect(await matches(secret, code === '000000' ? '000001' : '000000')).toBe(false)
  })

  test('recovery codes are ten distinct hex words, and secrets read as base32', () => {
    const codes = recoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/)
    expect(base32(new Uint8Array([0, 0, 0, 0, 0]))).toBe('AAAAAAAA')
  })
})
