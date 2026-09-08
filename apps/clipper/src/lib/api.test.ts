import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, ApiError, BASE, outOfSpace, pathTaken } from './api'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

const calls: Call[] = []

/** A service that answers whatever the test says, and writes down what it was
 *  asked. Enough of `fetch` for this client, and nothing more. */
function answering(status: number, body: unknown) {
  vi.stubGlobal('fetch', (url: string, options: RequestInit = {}) => {
    calls.push({
      url,
      method: options.method ?? 'GET',
      headers: (options.headers ?? {}) as Record<string, string>,
      body: options.body,
    })

    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    })
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  calls.length = 0
})

describe('asking for a code', () => {
  test('posts the address and answers how long until another', async () => {
    answering(200, { ok: true, resendIn: 42 })

    expect(await api.requestCode('me@example.com')).toBe(42)
    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/code`)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toBe('{"email":"me@example.com"}')
  })

  test('answers no wait when the service names none', async () => {
    answering(200, { ok: true })
    expect(await api.requestCode('me@example.com')).toBe(0)
  })

  test('carries the words the service used when it refuses', async () => {
    answering(400, { error: 'enter a valid email address' })

    await expect(api.requestCode('nope')).rejects.toThrow('enter a valid email address')
  })

  test('says something when the service says nothing', async () => {
    answering(502, 'gateway')
    await expect(api.requestCode('me@example.com')).rejects.toThrow('request failed (502)')
  })
})

describe('checking a code', () => {
  test('answers the session and who it belongs to', async () => {
    answering(200, { token: 'abc', user: { id: 'u1', email: 'me@example.com', name: null } })

    expect(await api.verifyCode('me@example.com', '123456')).toEqual({
      token: 'abc',
      user: { email: 'me@example.com' },
    })
  })

  test('refuses an answer with no session in it', async () => {
    answering(200, { user: { email: 'me@example.com' } })
    await expect(api.verifyCode('me@example.com', '123456')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('the spaces on an account', () => {
  test('come back in the order the rail shows them', async () => {
    answering(200, {
      spaces: [
        { id: 'b', name: 'Work', position: 2 },
        { id: 'a', name: 'Notes', position: 1 },
      ],
    })

    const spaces = await api.listSpaces('token')
    expect(spaces.map((space) => space.name)).toEqual(['Notes', 'Work'])
  })

  test('carry the session', async () => {
    answering(200, { spaces: [] })
    await api.listSpaces('token')

    expect(calls[0]?.headers.authorization).toBe('Bearer token')
  })

  test('leave out a row that is not a space', async () => {
    answering(200, { spaces: [{ id: 'a', name: 'Notes' }, { id: 'b' }, null] })

    const spaces = await api.listSpaces('token')
    expect(spaces).toEqual([{ id: 'a', name: 'Notes', position: 0 }])
  })

  test('are none when the answer holds no list', async () => {
    answering(200, { spaces: 'all of them' })
    expect(await api.listSpaces('token')).toEqual([])
  })
})

describe('writing a note', () => {
  test('posts the path and the content into the space', async () => {
    answering(201, { note: { id: 'n1', path: 'Reading/A.md' } })

    expect(await api.createNote('token', 's1', 'Reading/A.md', '# A')).toEqual({
      path: 'Reading/A.md',
    })
    expect(calls[0]?.url).toBe(`${BASE}/v1/spaces/s1/notes`)
    expect(calls[0]?.body).toBe('{"path":"Reading/A.md","content":"# A"}')
  })

  test('keeps an id inside the segment it was given', async () => {
    answering(201, { note: { path: 'A.md' } })

    await api.createNote('token', '../../v1/me', 'A.md', '# A')
    expect(calls[0]?.url).toBe(`${BASE}/v1/spaces/..%2F..%2Fv1%2Fme/notes`)
  })

  test('is a path being taken when the service says so', async () => {
    answering(409, { error: 'a note already lives there' })

    const refusal = await api
      .createNote('token', 's1', 'A.md', '# A')
      .catch((error: unknown) => error)
    expect(pathTaken(refusal)).toBe(true)
    expect(outOfSpace(refusal)).toBe(false)
  })

  test('is the account being full when the service says that', async () => {
    answering(507, { error: 'out of space' })

    const refusal = await api
      .createNote('token', 's1', 'A.md', '# A')
      .catch((error: unknown) => error)
    expect(outOfSpace(refusal)).toBe(true)
  })
})

describe('uploading a picture', () => {
  test('puts the bytes under their own hash', async () => {
    answering(201, { hash: 'ab'.repeat(32), stored: true })
    const bytes = new Uint8Array([1, 2, 3]).buffer

    expect(await api.putBlob('token', 'ab'.repeat(32), 'image/png', bytes)).toEqual({
      hash: 'ab'.repeat(32),
      stored: true,
    })

    expect(calls[0]?.url).toBe(`${BASE}/v1/blobs/${'ab'.repeat(32)}`)
    expect(calls[0]?.method).toBe('PUT')
    expect(calls[0]?.headers['content-type']).toBe('image/png')
  })

  test('says the account already had it', async () => {
    answering(200, { hash: 'cd'.repeat(32), stored: false })
    const bytes = new Uint8Array([1]).buffer

    expect((await api.putBlob('token', 'cd'.repeat(32), 'image/png', bytes)).stored).toBe(false)
  })

  test('refuses a picture the service will not keep', async () => {
    answering(415, { error: 'images and PDFs only' })
    const bytes = new Uint8Array([1]).buffer

    await expect(api.putBlob('token', 'ef'.repeat(32), 'image/svg+xml', bytes)).rejects.toThrow(
      'images and PDFs only',
    )
  })
})

describe('recognising a refusal', () => {
  test('needs it to be one of ours', () => {
    expect(outOfSpace(new Error('out of space'))).toBe(false)
    expect(pathTaken('409')).toBe(false)
  })
})
