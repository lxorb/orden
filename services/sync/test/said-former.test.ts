import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { said } from '../src/said'
import { call, type TestEnv, testEnv } from './harness'

describe('a header an app from before the rename sends', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => {
    env.close()
  })

  test('is read under its old name, and the new name wins', () => {
    const headers = (pairs: Record<string, string>) => {
      const all = new Headers(pairs)
      return (name: string) => all.get(name)
    }
    expect(said(headers({ 'x-nib-device': 'old' }), 'device')).toBe('old')
    expect(said(headers({ 'x-orden-device': 'new', 'x-nib-device': 'old' }), 'device')).toBe('new')
    expect(said(headers({}), 'device')).toBeUndefined()
  })

  test('may cross from an app on another origin under either name', async () => {
    const answer = await call(env, '/v1/notes', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:1420',
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'x-nib-device',
      },
    })
    const allowed = (answer.headers.get('access-control-allow-headers') ?? '').split(',')
    expect(allowed.map((one) => one.trim())).toEqual(
      expect.arrayContaining([
        'x-nib-device',
        'x-orden-device',
        'x-nib-diagram',
        'x-orden-diagram',
      ]),
    )
  })
})
