import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { opened, sealed } from '../src/sync-server/src/ai-key'
import { call, signIn, testEnv, type TestEnv } from './harness'
import type { ShareView } from './harness'

const SECRET = 'a secret nobody in this repository knows'
const KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz-4f2a'
let env: TestEnv
let token: string
beforeEach(async () => {
  env = testEnv({ OPENAI_KEY_SECRET: SECRET })
  token = await signIn(env, 'a@b.dev')
})
afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})
function put(key: string, as = token) {
  return call(env, '/v1/ask/key', { method: 'PUT', token: as, body: { key } })
}
function state(as = token) {
  return call(env, '/v1/settings', { token: as })
}
function stored(): { openai_key: string | null; openai_key_tail: string | null } {
  return env.db.prepare('select openai_key, openai_key_tail from users').get() as {
    openai_key: string | null
    openai_key_tail: string | null
  }
}
function userId(): string {
  return (env.db.prepare('select id from users').get() as { id: string }).id
}
describe('a key at rest', () => {
  test('goes round trip', async () => {
    const box = await sealed(SECRET, 'u1', KEY)
    expect(box).not.toContain(KEY)
    expect(await opened(SECRET, 'u1', box)).toBe(KEY)
  })
  test('is different bytes every time, so two identical keys do not look identical', async () => {
    const one = await sealed(SECRET, 'u1', KEY)
    const two = await sealed(SECRET, 'u1', KEY)
    expect(one).not.toBe(two)
    expect(await opened(SECRET, 'u1', two)).toBe(KEY)
  })
  test('will not open under another account, so moving the column borrows nothing', async () => {
    const box = await sealed(SECRET, 'u1', KEY)
    expect(await opened(SECRET, 'u2', box)).toBeNull()
  })
  test('will not open under another secret', async () => {
    const box = await sealed(SECRET, 'u1', KEY)
    expect(await opened('something else', 'u1', box)).toBeNull()
  })
  test('will not open when somebody has edited the bytes', async () => {
    const box = await sealed(SECRET, 'u1', KEY)
    const [version, nonce, body] = box.split('.')
    expect(await opened(SECRET, 'u1', `${version}.${nonce}.${(body ?? '').slice(0, -4)}AAAA`)).toBe(null)
    expect(await opened(SECRET, 'u1', `2.${nonce}.${body}`)).toBeNull()
    expect(await opened(SECRET, 'u1', 'nonsense')).toBeNull()
  })
})
describe('setting the key', () => {
  test('answers that it is set and the last four characters, and nothing else', async () => {
    const { status, json } = await put(KEY)
    expect(status).toBe(200)
    expect(json).toEqual({ set: true, tail: '4f2a' })
  })
  test('stores something that is not the key', async () => {
    await put(KEY)
    const row = stored()
    expect(row.openai_key).toBeTruthy()
    expect(row.openai_key).not.toContain(KEY)
    expect(row.openai_key).not.toContain('sk-')
    expect(row.openai_key_tail).toBe('4f2a')
  })
  test('and what it stored opens back to the key, for the one caller that may', async () => {
    await put(KEY)
    expect(await opened(SECRET, userId(), stored().openai_key ?? '')).toBe(KEY)
  })
  test('replaces on a second write, because there is no editing what cannot be read', async () => {
    await put(KEY)
    const again = await put('sk-proj-something-completely-else-9999')
    expect(again.json).toEqual({ set: true, tail: '9999' })
    expect(await opened(SECRET, userId(), stored().openai_key ?? '')).toBe('sk-proj-something-completely-else-9999')
  })
  test('trims what was pasted, because a key off a web page brings a newline', async () => {
    await put(`  ${KEY}\n`)
    expect(await opened(SECRET, userId(), stored().openai_key ?? '')).toBe(KEY)
  })
  test('refuses something that is not a key, and stores nothing', async () => {
    for (const wrong of ['', 'sk-short', `${KEY} ${KEY}`]) {
      expect((await put(wrong)).status, wrong).toBe(400)
    }
    expect(stored().openai_key).toBeNull()
  })
  test('refuses to store at all when the server has no secret', async () => {
    const bare = testEnv()
    const only = await signIn(bare, 'c@d.dev')
    const answer = await call(bare, '/v1/ask/key', {
      method: 'PUT',
      token: only,
      body: { key: KEY },
    })
    expect(answer.status).toBe(503)
    expect(answer.json.error).toBe('this server cannot keep a key yet')
    expect(
      (
        bare.db.prepare('select openai_key, openai_key_tail from users').get() as {
          openai_key: unknown
        }
      ).openai_key,
    ).toBeNull()
    bare.close()
  })
})
describe('reading the key', () => {
  test('is not something any route offers', async () => {
    await put(KEY)
    const { json, text } = await state()
    expect(json.key).toEqual({ set: true, tail: '4f2a' })
    expect(text).not.toContain(KEY)
    expect(text).not.toContain('sk-')
  })
  test('says so when there is none', async () => {
    expect((await state()).json.key).toEqual({ set: false, tail: '' })
  })
  test('works even where the server could not decrypt one, because it decrypts nothing', async () => {
    await put(KEY)
    const bare = testEnv()
    bare.db.exec(
      `insert into users (id, email, created_at, settings, openai_key, openai_key_tail)
       values ('u', 'e@f.dev', 1, '{}', 'unreadable', '4f2a')`,
    )
    const one = await signIn(bare, 'g@h.dev')
    expect((await call(bare, '/v1/settings', { token: one })).json.key).toEqual({
      set: false,
      tail: '',
    })
    bare.close()
  })
  test('is gone once it is taken away', async () => {
    await put(KEY)
    const removed = await call(env, '/v1/ask/key', { method: 'DELETE', token })
    expect(removed.json).toEqual({ set: false, tail: '' })
    expect(stored()).toEqual({ openai_key: null, openai_key_tail: null })
    expect((await state()).json.key).toEqual({ set: false, tail: '' })
  })
  test('cannot be smuggled back in through the settings', async () => {
    const patched = await call(env, '/v1/settings', {
      method: 'PATCH',
      token,
      body: { glassesKey: KEY },
    })
    expect(patched.status).toBe(400)
    expect(patched.json.error).toBe('unknown setting glassesKey')
    expect((await state()).json.settings).toEqual({})
  })
})
async function noteIn(as: string, space: string, path: string, content: string): Promise<void> {
  await call(env, `/v1/spaces/${space}/notes`, { token: as, body: { path, content } })
}
async function firstSpace(as: string): Promise<string> {
  const { json } = await call(env, '/v1/spaces', { token: as })
  return json.spaces[0]?.id ?? ''
}
describe('what the microphone heard', () => {
  beforeEach(async () => {
    await put(KEY)
  })
  function heard(body: BodyInit, as = token) {
    return call(env, '/v1/ask/heard', {
      method: 'POST',
      token: as,
      raw: body,
      headers: { 'content-type': 'audio/wav' },
    })
  }
  function modelIn(form: FormData): string {
    const value = form.get('model')
    return typeof value === 'string' ? value : ''
  }
  test('comes back as words', async () => {
    let model = ''
    vi.stubGlobal('fetch', async (url: string, options: { body: FormData }) => {
      expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
      model = modelIn(options.body)
      return Promise.resolve(new Response('open page three\n'))
    })
    const { status, json } = await heard(new Uint8Array([1, 2, 3, 4]))
    expect(status).toBe(200)
    expect(json.said).toBe('open page three')
    expect(model).toBe('gpt-transcribe')
  })
  test('falls to the next model where the account has not got the first', async () => {
    const tried: string[] = []
    vi.stubGlobal('fetch', async (_url: string, options: { body: FormData }) => {
      const model = modelIn(options.body)
      tried.push(model)
      return Promise.resolve(model === 'whisper-1' ? new Response('next') : new Response('no', { status: 404 }))
    })
    expect((await heard(new Uint8Array([1]))).json.said).toBe('next')
    expect(tried).toEqual(['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'])
  })
  test('listens on Workers AI first, and does not leave the building for it', async () => {
    const asked: string[] = []
    env.AI = {
      run(model: string) {
        asked.push(model)
        return Promise.resolve({ text: 'heard it anyway' })
      },
    }
    vi.stubGlobal('fetch', () => {
      throw new Error('the key is the fallback, not the first stop')
    })
    expect((await heard(new Uint8Array([1]))).json.said).toBe('heard it anyway')
    expect(asked).toEqual(['@cf/openai/whisper-large-v3-turbo'])
  })
  test('and spends the key only where the near models heard nothing', async () => {
    const asked: string[] = []
    env.AI = {
      run(model: string) {
        asked.push(model)
        return Promise.resolve({ text: '' })
      },
    }
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('through the key')))
    expect((await heard(new Uint8Array([1]))).json.said).toBe('through the key')
    expect(asked).toEqual(['@cf/openai/whisper-large-v3-turbo', '@cf/openai/whisper'])
  })
  test('leans on the words the plugin said it was hoping for', async () => {
    let prompted: unknown = null
    env.AI = {
      run(_model: string, input: unknown) {
        prompted = (input as { initial_prompt?: unknown }).initial_prompt
        return Promise.resolve({ text: 'next' })
      },
    }
    const { json } = await call(env, '/v1/ask/heard?like=next%2C%20back%2C%20close', {
      method: 'POST',
      token,
      raw: new Uint8Array([1]),
      headers: { 'content-type': 'audio/wav' },
    })
    expect(json.said).toBe('next')
    expect(prompted).toBe('next, back, close')
  })
  test('and takes a list of commands rather than a paragraph of somebody else', async () => {
    let prompted = ''
    env.AI = {
      run(_model: string, input: unknown) {
        const said = (input as { initial_prompt?: unknown }).initial_prompt
        prompted = typeof said === 'string' ? said : ''
        return Promise.resolve({ text: 'next' })
      },
    }
    await call(env, `/v1/ask/heard?like=${'x'.repeat(900)}`, {
      method: 'POST',
      token,
      raw: new Uint8Array([1]),
      headers: { 'content-type': 'audio/wav' },
    })
    expect(prompted.length).toBe(300)
  })
  test('answers null where none of them heard anything', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 500 })))
    expect((await heard(new Uint8Array([1]))).json.said).toBeNull()
  })
  test('answers null rather than an error where the key cannot be reached', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')))
    const { status, json } = await heard(new Uint8Array([1]))
    expect(status).toBe(200)
    expect(json.said).toBeNull()
  })
  test('refuses silence and refuses a recording that is too long', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('never asked')))
    expect((await heard(new Uint8Array())).status).toBe(400)
    expect(
      (
        await call(env, '/v1/ask/heard', {
          method: 'POST',
          token,
          raw: new Uint8Array([1]),
          headers: { 'content-type': 'audio/wav', 'content-length': String(9 * 1024 * 1024) },
        })
      ).status,
    ).toBe(413)
  })
})
describe('what the microphone heard with no key', () => {
  function wav(seconds: number): Uint8Array {
    const rate = 16_000
    const bytes = Math.round(seconds * rate * 2)
    const file = new Uint8Array(44 + bytes)
    const view = new DataView(file.buffer)
    const write = (at: number, text: string) => {
      for (let step = 0; step < text.length; step++) file[at + step] = text.charCodeAt(step)
    }
    write(0, 'RIFF')
    view.setUint32(4, 36 + bytes, true)
    write(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    write(36, 'data')
    view.setUint32(40, bytes, true)
    return file
  }
  function workersAi(answers: Record<string, unknown>) {
    const asked: { model: string; input: unknown }[] = []
    const AI = {
      run(model: string, input: unknown): Promise<unknown> {
        asked.push({ model, input })
        const answer = answers[model]
        if (answer === undefined) return Promise.reject(new Error('no such model'))
        return Promise.resolve(answer)
      },
    }
    return { AI, asked }
  }
  function heard(body: BodyInit, as = token) {
    return call(env, '/v1/ask/heard', {
      method: 'POST',
      token: as,
      raw: body,
      headers: { 'content-type': 'audio/wav' },
    })
  }
  test('listens on Workers AI, and never asks OpenAI for anything', async () => {
    const { AI, asked } = workersAi({
      '@cf/openai/whisper-large-v3-turbo': { text: ' open page four ' },
    })
    env.AI = AI
    vi.stubGlobal('fetch', () => {
      throw new Error('no key, so nothing may leave for OpenAI')
    })
    const { status, json } = await heard(wav(1.5))
    expect(status).toBe(200)
    expect(json.said).toBe('open page four')
    expect(asked.map((one) => one.model)).toEqual(['@cf/openai/whisper-large-v3-turbo'])
    expect(typeof (asked[0]?.input as { audio: unknown }).audio).toBe('string')
  })
  test('falls to the older Whisper where turbo will not take it', async () => {
    const { AI, asked } = workersAi({ '@cf/openai/whisper': { text: 'next one' } })
    env.AI = AI
    expect((await heard(wav(1))).json.said).toBe('next one')
    expect(asked.map((one) => one.model)).toEqual(['@cf/openai/whisper-large-v3-turbo', '@cf/openai/whisper'])
    expect(Array.isArray((asked[1]?.input as { audio: unknown }).audio)).toBe(true)
  })
  test('answers nothing rather than an error where neither model heard a word', async () => {
    const { AI } = workersAi({
      '@cf/openai/whisper-large-v3-turbo': { text: '   ' },
      '@cf/openai/whisper': {},
    })
    env.AI = AI
    const { status, json } = await heard(wav(1))
    expect(status).toBe(200)
    expect(json.said).toBeNull()
  })
  test('and where the binding is not there at all, which is a server not ready', async () => {
    const { status, json } = await heard(wav(1))
    expect(status).toBe(200)
    expect(json.said).toBeNull()
  })
  test('refuses more audio than one piece holds, by its seconds', async () => {
    const { AI, asked } = workersAi({
      '@cf/openai/whisper-large-v3-turbo': { text: 'never asked' },
    })
    env.AI = AI
    expect((await heard(wav(110))).status).toBe(200)
    const long = await heard(wav(121))
    expect(long.status).toBe(413)
    expect(long.json.error).toContain('too long')
    expect(asked).toHaveLength(1)
  })
  test('counts every utterance against the same ceiling, key or no key', async () => {
    const { AI } = workersAi({ '@cf/openai/whisper-large-v3-turbo': { text: 'again' } })
    env.AI = AI
    env.db
      .prepare('insert into limits (scope, key, count, until) values (?, ?, ?, ?)')
      .run('said', userId(), 600, Date.now() + 60 * 60 * 1000)
    const over = await heard(wav(1))
    expect(over.status).toBe(429)
    expect(over.json.error).toContain('a lot of listening')
  })
  test('a guest may not listen either', async () => {
    const { AI } = workersAi({ '@cf/openai/whisper-large-v3-turbo': { text: 'never asked' } })
    env.AI = AI
    expect((await heard(wav(1), 'not-a-session')).status).toBe(401)
  })
})
describe('a guest', () => {
  async function guest(): Promise<string> {
    const space = await firstSpace(token)
    await noteIn(token, space, 'plan.md', '# Plan\n')
    const { json } = await call<ShareView>(env, `/v1/spaces/${space}/share/link`, {
      method: 'PUT',
      token,
      body: { role: 'read', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
    const followed = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      body: { device: 'iPhone' },
    })
    return followed.json.token
  }
  test('cannot set a key, nor take one away', async () => {
    const as = await guest()
    expect((await put(KEY, as)).status).toBe(403)
    expect((await call(env, '/v1/ask/key', { method: 'DELETE', token: as })).status).toBe(403)
    expect((await state(as)).status).toBe(403)
  })
})
describe('a piece of a recording', () => {
  function wav(seconds: number): Uint8Array {
    const rate = 16_000
    const bytes = Math.round(seconds * rate * 2)
    const file = new Uint8Array(44 + bytes)
    const view = new DataView(file.buffer)
    const write = (at: number, text: string) => {
      for (let step = 0; step < text.length; step++) file[at + step] = text.charCodeAt(step)
    }
    write(0, 'RIFF')
    view.setUint32(4, 36 + bytes, true)
    write(8, 'WAVEfmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    write(36, 'data')
    view.setUint32(40, bytes, true)
    return file
  }
  function piece(body: BodyInit) {
    return call(env, '/v1/ask/heard?piece=1', {
      method: 'POST',
      token,
      raw: body,
      headers: { 'content-type': 'audio/wav' },
    })
  }
  test('may be far longer than a spoken command', async () => {
    env.AI = { run: () => Promise.resolve({ text: 'and then we agreed on the fonts' }) }
    const { status, json } = await piece(wav(30))
    expect(status).toBe(200)
    expect(json.said).toBe('and then we agreed on the fonts')
  })
  test('but not longer than one request should hold', async () => {
    env.AI = { run: () => Promise.resolve({ text: 'never asked' }) }
    const over = await piece(wav(130))
    expect(over.status).toBe(413)
    expect(over.json.error).toContain('too long')
  })
  test('comes back with the language the model settled on', async () => {
    env.AI = {
      run: () =>
        Promise.resolve({
          text: 'Guten Morgen',
          transcription_info: { language: 'de', language_probability: 0.99 },
        }),
    }
    const { json } = await piece(wav(20))
    expect(json.said).toBe('Guten Morgen')
    expect(json.language).toBe('de')
  })
  test('and with no language where the model did not name one', async () => {
    env.AI = { run: () => Promise.resolve({ text: 'morning' }) }
    expect((await piece(wav(20))).json.language).toBe('')
  })
})
test('there is no summary route any more', async () => {
  await put(KEY)
  const gone = await call(env, '/v1/ask/summary', { token, body: { text: 'words', model: 'm' } })
  expect(gone.status).toBe(404)
})
