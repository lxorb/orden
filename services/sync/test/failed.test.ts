import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { EmailSender } from '../src/sync-server/src/types'
import { call, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv

beforeEach(() => {
  env = testEnv()
})

afterEach(() => {
  env.close()
  vi.restoreAllMocks()
})

async function logged(work: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    lines.push(String(line))
  })

  await work()
  return lines
}

function breakTheStore(): void {
  env.db.exec('drop table spaces')
}

describe('a route that throws', () => {
  test('answers JSON with the field every other refusal here uses', async () => {
    const token = await signIn(env, 'a@b.dev')
    breakTheStore()

    let status = 0
    let said: unknown = null
    await logged(async () => {
      const response = await call(env, '/v1/spaces', { token })
      status = response.status
      said = response.json.error
    })

    expect(status).toBe(500)
    expect(said).toBe('something went wrong here - try again')
  })

  test('writes down the route and what the error said', async () => {
    const token = await signIn(env, 'a@b.dev')
    breakTheStore()

    const lines = await logged(() => call(env, '/v1/spaces', { token }))

    expect(lines).toHaveLength(1)
    const written = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(written.failed).toBe('GET /v1/spaces')
    expect(String(written.said)).toContain('spaces')
  })

  test('names the request in both halves, so a report and a log line meet', async () => {
    const token = await signIn(env, 'a@b.dev')
    breakTheStore()

    let answered: unknown = null
    const lines = await logged(async () => {
      const response = await call(env, '/v1/spaces', {
        token,
        headers: { 'cf-ray': '8f2c1d4e5a6b7c8d-ZRH' },
      })
      answered = (response.json as { id?: unknown }).id
    })

    expect(answered).toBe('8f2c1d4e5a6b7c8d-ZRH')
    expect((JSON.parse(lines[0] ?? '{}') as { id?: unknown }).id).toBe('8f2c1d4e5a6b7c8d-ZRH')
  })
})

describe('what is never written down', () => {
  test('keeps an address out of the log, even when a provider quotes it back', async () => {
    const refusing: EmailSender = {
      send: () => Promise.reject(new Error('550 no mailbox for someone@example.com')),
    }

    env.close()
    env = testEnv({ MAIL_FROM: 'Nib <nib@nibeditor.com>', EMAIL: refusing })

    const lines = await logged(() =>
      call(env, '/v1/auth/code', { body: { email: 'someone@example.com' } }),
    )

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('someone@example.com')
    expect(lines[0]).toContain('<address>')
    expect(lines[0]).toContain('550 no mailbox')
  })
})
