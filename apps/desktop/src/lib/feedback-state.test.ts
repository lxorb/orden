import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Service {
  answer: unknown
  fails: Error | null
  sent: { path: string; body: unknown }[]
}

const api = vi.hoisted((): Service => ({ answer: null, fails: null, sent: [] }))
vi.mock('./accounts/src/client', () => ({
  request: (path: string, options: { body: unknown }) => {
    api.sent.push({ path, body: options.body })
    return api.fails ? Promise.reject(api.fails) : Promise.resolve(api.answer)
  },
}))
vi.mock('./accounts/src/account.svelte', () => ({ account: { token: null } }))

const { feedback } = await import('./feedback.svelte')
const { log } = await import('./log')

beforeEach(() => {
  api.answer = null
  api.fails = null
  api.sent = []
  feedback.show()
})

describe('a report', () => {
  test('is received once the service says it kept it, with its page', async () => {
    api.answer = { ok: true, id: 'r1', url: 'https://orden.so/v1/feedback/r1/key' }
    expect(feedback.received).toBeNull()
    await feedback.send('  It broke.  ', ['data:image/png;base64,AAAA'])
    expect(feedback.received).toEqual({ url: 'https://orden.so/v1/feedback/r1/key' })
    expect(api.sent[0]?.path).toBe('/v1/feedback')
    expect(api.sent[0]?.body).toMatchObject({
      text: 'It broke.',
      images: ['data:image/png;base64,AAAA'],
    })
  })

  test('sends the log without the reader’s paths, which is what the sheet says', async () => {
    api.answer = { ok: true, id: 'r1' }
    log('error', 'save: /home/anna/Notes/Divorce lawyer.md - disk full')
    await feedback.send('It broke.')
    const { log: sent } = api.sent[0]?.body as { log: string }
    expect(sent).toContain('error save: <path 1>.md - disk full')
    expect(sent).not.toMatch(/anna|Divorce/)
  })

  test('sends no pictures where there are none', async () => {
    api.answer = { ok: true, id: 'r1' }
    await feedback.send('It broke.')
    expect(api.sent[0]?.body).not.toHaveProperty('images')
    expect(feedback.received).toEqual({ url: null })
  })

  test('the service did not keep is never received', async () => {
    api.fails = new Error('try again in an hour')
    await expect(feedback.send('It broke.')).rejects.toThrow('try again in an hour')
    expect(feedback.received).toBeNull()

    api.fails = null
    api.answer = {}
    await expect(feedback.send('It broke.')).rejects.toThrow()
    expect(feedback.received).toBeNull()
  })

  test('opened again starts unreceived', async () => {
    api.answer = { ok: true, id: 'r1', url: 'https://orden.so/v1/feedback/r1/key' }
    await feedback.send('It broke.')
    feedback.close()
    feedback.show()
    expect(feedback.received).toBeNull()
  })
})
