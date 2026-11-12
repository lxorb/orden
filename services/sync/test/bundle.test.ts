import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { carry } from '../src/sync-server-machines/src/machines/bundle'
import { call, type TestEnv, testEnv } from './harness'

const BYTES = new TextEncoder().encode('install.sh and ordend, gzipped')
const SHA = createHash('sha256').update('install.sh and ordend, gzipped').digest('hex')

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
})

describe('the machine bundle', () => {
  test('says its SHA-256 and serves its bytes by it, to anybody', async () => {
    carry(BYTES.slice().buffer)
    const current = await call(env, '/v2/online/machine/current')
    expect(current.status).toBe(200)
    expect(current.text).toBe(SHA)

    const bundle = await call(env, `/v2/online/machine/${SHA}.bin`)
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get('cache-control')).toContain('immutable')
    expect(bundle.text).toBe('install.sh and ordend, gzipped')

    expect((await call(env, `/v2/online/machine/${'0'.repeat(64)}.bin`)).status).toBe(404)
  })
})
