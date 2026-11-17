import { describe, expect, test, vi } from 'vitest'

const service = vi.hoisted(() => ({ sent: [] as { path: string; body: unknown }[] }))

vi.mock('../../accounts/src/api', () => ({
  account: { token: null },
  request: (path: string, options: { body: unknown }) => {
    service.sent.push({ path, body: options.body })
    return Promise.resolve({ ok: true, url: 'https://orden.so/feedback/1' })
  },
}))

const { feedback, scrubbedLog } = await import('../src/api')

describe('a log said to the service', () => {
  test('keeps what went wrong and loses the paths and addresses in it', () => {
    const said = scrubbedLog('12:00 WARN  /home/anna/Notes/Bank.md not read for anna@example.org')
    expect(said).toBe('12:00 WARN  <path 1>.md not read for <email>')
  })
})

describe('the feedback sheet', () => {
  test('opens unreceived, and is received once the service keeps the report', async () => {
    feedback.show()
    expect(feedback.open).toBe(true)
    expect(feedback.received).toBeNull()
    await feedback.send('  It works.  ')
    expect(service.sent.map((one) => one.path)).toEqual(['/v1/feedback'])
    expect(service.sent[0]?.body).toMatchObject({ text: 'It works.' })
    expect(feedback.received).toEqual({ url: 'https://orden.so/feedback/1' })
    feedback.close()
    expect(feedback.open).toBe(false)
  })
})
