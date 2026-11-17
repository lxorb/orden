import { beforeEach, describe, expect, test, vi } from 'vitest'

interface Service {
  answer: unknown
  fails: Error | null
  sent: { path: string; body: unknown }[]
}

const api = vi.hoisted((): Service => ({ answer: null, fails: null, sent: [] }))
vi.mock('../../accounts/src/api', () => ({
  account: { token: null },
  request: (path: string, options: { body: unknown }) => {
    api.sent.push({ path, body: options.body })
    return api.fails ? Promise.reject(api.fails) : Promise.resolve(api.answer)
  },
}))

const kept = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => kept.set(key, value),
  removeItem: (key: string) => kept.delete(key),
  clear: () => kept.clear(),
})

const { feedback } = await import('./feedback.svelte')
const { log } = await import('../../platform/src/api')

beforeEach(() => {
  api.answer = null
  api.fails = null
  api.sent = []
  kept.clear()
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

describe('the requests sent before (#2059)', () => {
  test('are none until one is received', async () => {
    expect(feedback.past).toEqual([])
    api.fails = new Error('offline')
    await expect(feedback.send('It broke.')).rejects.toThrow()
    api.fails = null
    api.answer = { ok: true, id: 'r0' }
    await feedback.send('No page for this one.')
    expect(feedback.past).toEqual([])
  })

  test('are kept on the device, newest first, by their first line and their page', async () => {
    api.answer = { ok: true, id: 'r1', url: 'https://orden.so/v1/feedback/r1/a' }
    await feedback.send('It broke.\nWhen I pressed save.')
    api.answer = { ok: true, id: 'r2', url: 'https://orden.so/v1/feedback/r2/b' }
    await feedback.send('Again.')

    feedback.close()
    feedback.show()
    expect(feedback.past.map((one) => [one.title, one.url])).toEqual([
      ['Again.', 'https://orden.so/v1/feedback/r2/b'],
      ['It broke.', 'https://orden.so/v1/feedback/r1/a'],
    ])
  })
})
