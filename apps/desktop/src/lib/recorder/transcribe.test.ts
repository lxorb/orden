import { beforeEach, describe, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

let apiKey = ''
vi.mock('../ai/keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/keys')>()),
  readKey: () => Promise.resolve(apiKey),
}))

const askedAccount: number[] = []
const likedAccount: string[] = []
vi.mock('../api', () => ({
  api: {
    askPiece: (_token: string, wav: Uint8Array, like = '') => {
      askedAccount.push(wav.byteLength)
      likedAccount.push(like)
      return Promise.resolve({ said: 'the account heard this', language: 'en' })
    },
  },
}))

interface Sent {
  url: string
  headers: Record<string, string>
  model: string
  format: string
  prompt: string
  file: { size: number; type: string; name: string } | null
}

const sent: Sent[] = []
let answers: { status: number; body: string }[] = []

function said(form: FormData, name: string): string {
  const found = form.get(name)
  return typeof found === 'string' ? found : ''
}

vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
  const form = init.body as FormData
  const file = form.get('file')

  sent.push({
    url,
    headers: (init.headers ?? {}) as Record<string, string>,
    model: said(form, 'model'),
    format: said(form, 'response_format'),
    prompt: said(form, 'prompt'),
    file:
      file instanceof Blob
        ? {
            size: file.size,
            type: file.type,
            name: file instanceof File ? file.name : '',
          }
        : null,
  })

  const next = answers.shift() ?? { status: 200, body: JSON.stringify({ text: 'heard' }) }
  return new Response(next.body, {
    status: next.status,
    headers: { 'content-type': 'application/json' },
  })
})

const { account } = await import('../account.svelte')
const { ai } = await import('../ai/store.svelte')
const { canTranscribe } = await import('../ai/hears')
const { heardPiece, transcribedBy, WHISPER } = await import('./transcribe')

const wav = new Uint8Array(new ArrayBuffer(2048))

function local(): void {
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'On this machine', baseUrl: 'http://localhost:23311', model: 'llama' })
  ai.setDefault(made.id)
}

function hosted(): void {
  const made = ai.add('openai')
  ai.update(made.id, { model: 'gpt-5' })
  ai.setDefault(made.id)
}

function claude(): void {
  const made = ai.add('anthropic')
  ai.update(made.id, { model: 'claude-4' })
  ai.setDefault(made.id)
}

beforeEach(() => {
  for (const one of [...ai.accounts]) ai.remove(one.id)
  sent.length = 0
  askedAccount.length = 0
  likedAccount.length = 0
  answers = []
  apiKey = ''
  account.token = null
  account.user = null
})

function signedIn(): void {
  account.token = 'a-session'
  account.user = { id: 'drive', email: 'drive@example.com', name: 'Drive' }
}

describe('whether there is anything to ask at all', () => {
  test('no provider and no account is nothing', () => {
    expect(canTranscribe()).toBe(false)
  })

  test('a provider of the reader’s own is enough, with no account anywhere', () => {
    local()
    expect(canTranscribe()).toBe(true)
  })

  test('and so is an account with no provider', () => {
    signedIn()
    expect(canTranscribe()).toBe(true)
  })

  test('but Claude alone is not, because there is no route to ask', () => {
    claude()
    expect(ai.ready).toBe(true)
    expect(canTranscribe()).toBe(false)
  })
})

describe('what the note says wrote it', () => {
  test('is Whisper on the account’s road', () => {
    signedIn()
    expect(transcribedBy()).toBe(WHISPER)
  })

  test('and the model’s own name where the reader chose one', () => {
    hosted()
    expect(transcribedBy()).toBe('gpt-transcribe')

    for (const one of [...ai.accounts]) ai.remove(one.id)
    local()
    expect(transcribedBy()).toBe('whisper-1')
  })
})

describe('a recording with a provider set up', () => {
  test('goes to the provider’s own route and never to the account', async () => {
    local()

    const heard = await heardPiece(wav)
    expect(heard.text).toBe('heard')
    expect(askedAccount).toEqual([])
    expect(sent).toHaveLength(1)
    expect(sent[0]?.url).toBe('http://localhost:23311/v1/audio/transcriptions')
  })

  test('carries the sound as a file, and names no content type of its own', async () => {
    local()
    await heardPiece(wav)

    expect(sent[0]?.headers['content-type']).toBeUndefined()
    expect(sent[0]?.file).toEqual({ size: wav.byteLength, type: 'audio/wav', name: 'said.wav' })
  })

  test('asks a server on this machine for whisper, and for the language with it', async () => {
    local()
    await heardPiece(wav)

    expect(sent[0]?.model).toBe('whisper-1')
    expect(sent[0]?.format).toBe('verbose_json')
  })

  test('and says which language, where the model said', async () => {
    local()
    answers = [{ status: 200, body: JSON.stringify({ text: 'guten Morgen', language: 'german' }) }]

    expect(await heardPiece(wav)).toEqual({ text: 'guten Morgen', language: 'german' })
  })

  test('asks OpenAI for its own newer model, which says no language', async () => {
    hosted()
    apiKey = 'sk-test'
    await heardPiece(wav)

    expect(sent[0]?.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(sent[0]?.model).toBe('gpt-transcribe')
    expect(sent[0]?.format).toBe('json')
    expect(sent[0]?.headers.authorization).toBe('Bearer sk-test')
  })

  test('walks past a model the server does not have, and remembers the one it does', async () => {
    hosted()
    apiKey = 'sk-test'
    answers = [
      { status: 404, body: JSON.stringify({ error: { message: 'The model does not exist' } }) },
      { status: 200, body: JSON.stringify({ text: 'heard' }) },
    ]

    expect((await heardPiece(wav)).text).toBe('heard')
    expect(sent.map((one) => one.model)).toEqual(['gpt-transcribe', 'gpt-4o-mini-transcribe'])

    sent.length = 0
    await heardPiece(wav)
    expect(sent.map((one) => one.model)).toEqual(['gpt-4o-mini-transcribe'])
  })

  test('says a refused key out loud rather than trying another name', async () => {
    hosted()
    apiKey = 'sk-wrong'
    answers = Array.from({ length: 6 }, () => ({
      status: 401,
      body: JSON.stringify({ error: { message: 'Incorrect API key provided' } }),
    }))

    await expect(heardPiece(wav)).rejects.toThrow(/Incorrect API key/)
    expect(sent).toHaveLength(3)
    expect(new Set(sent.map((one) => one.model)).size).toBe(1)
  })

  test('a hosted provider with no key is not asked, and the account is not asked either', async () => {
    hosted()
    signedIn()

    await expect(heardPiece(wav)).rejects.toThrow(/not set up/)
    expect(sent).toEqual([])
    expect(askedAccount).toEqual([])
  })
})

describe('a recording with no provider at all', () => {
  test('goes to the account, which is what most readers have', async () => {
    signedIn()

    expect(await heardPiece(wav)).toEqual({ text: 'the account heard this', language: 'en' })
    expect(askedAccount).toEqual([wav.byteLength])
    expect(sent).toEqual([])
  })

  test('and says what to do about it when there is no account either', async () => {
    await expect(heardPiece(wav)).rejects.toThrow(/Add an AI provider or sign in/)
    expect(sent).toEqual([])
    expect(askedAccount).toEqual([])
  })
})

describe('a piece heard for dictation', () => {
  test('carries the expected words as the prompt, to a provider', async () => {
    local()
    await heardPiece(wav, { prompt: 'Jürgen Weißmüller, Tauri' })
    expect(sent[0]?.prompt).toBe('Jürgen Weißmüller, Tauri')
  })

  test('and to the account', async () => {
    signedIn()
    await heardPiece(wav, { prompt: 'Sync Worker' })
    expect(likedAccount).toEqual(['Sync Worker'])
  })

  test('sends no prompt field where nothing is expected', async () => {
    local()
    await heardPiece(wav)
    expect(sent[0]?.prompt).toBe('')
  })

  test('goes to the account when that is the road chosen, past a provider', async () => {
    local()
    signedIn()
    await heardPiece(wav, { road: 'account' })
    expect(sent).toEqual([])
    expect(askedAccount).toEqual([wav.byteLength])
  })

  test('and never to the account when the provider is the road chosen', async () => {
    signedIn()
    await expect(heardPiece(wav, { road: 'provider' })).rejects.toThrow(/Add an AI provider/)
    expect(askedAccount).toEqual([])
  })

  test('is tried as often as it is asked to be', async () => {
    hosted()
    apiKey = 'sk-wrong'
    answers = Array.from({ length: 3 }, () => ({ status: 500, body: '{}' }))
    await expect(heardPiece(wav, { tries: 1 })).rejects.toThrow()
    expect(sent).toHaveLength(1)
  })
})
