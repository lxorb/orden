import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../keys', () => ({ readKey: () => Promise.resolve('AIza-test') }))

const { createApiEngine } = await import('./engine')
const { forgetLearnt } = await import('./learned')
const { newThread } = await import('./threads')
const { catalogue } = await import('./catalogue')
const { contentsOf, gemini, UNSIGNED } = await import('./gemini')
const { complete } = await import('../complete')

import type { Provider } from '../providers'
import type { EngineEvent, ModelInfo, Thread, ToolOutput } from './types'
import type { Tools } from './tools'
import type { Ask } from './wire'

const ROOT = 'https://generativelanguage.googleapis.com/v1beta'
const PROVIDER: Provider = { id: 'gemini', kind: 'gemini', name: '', model: 'gemini-3-flash' }

interface Sent {
  url: string
  body: Record<string, unknown>
  headers: Record<string, string>
}
let sent: Sent[] = []
let answers: (() => Response)[] = []

const sse =
  (...events: unknown[]) =>
  () =>
    new Response(events.map((one) => `data: ${JSON.stringify(one)}\r\n\r\n`).join(''))

const PAGES: Record<string, unknown> = {
  '': {
    models: [
      {
        name: 'models/gemini-3-flash',
        displayName: 'Gemini 3 Flash',
        inputTokenLimit: 1_048_576,
        outputTokenLimit: 65_536,
        supportedGenerationMethods: ['generateContent', 'countTokens'],
        thinking: true,
      },
      {
        name: 'models/gemini-embedding-2',
        supportedGenerationMethods: ['embedContent'],
      },
    ],
    nextPageToken: 'two',
  },
  two: {
    models: [
      {
        name: 'models/gemini-2.5-flash-lite',
        displayName: 'Gemini 2.5 Flash-Lite',
        inputTokenLimit: 1_048_576,
        supportedGenerationMethods: ['generateContent'],
        thinking: true,
      },
      {
        name: 'models/gemini-3.1-flash-tts-preview',
        supportedGenerationMethods: ['generateContent'],
      },
    ],
  },
}

vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
  const headers = init.headers as Record<string, string>
  if (url.startsWith(`${ROOT}/models?`)) {
    const page = new URL(url).searchParams.get('pageToken') ?? ''
    sent.push({ url, body: {}, headers })
    return Promise.resolve(new Response(JSON.stringify(PAGES[page])))
  }
  sent.push({
    url,
    body: JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>,
    headers,
  })
  const next = answers.shift()
  if (!next) throw new Error(`nothing to answer ${url}`)
  return Promise.resolve(next())
})

const calls: { name: string; args: unknown }[] = []
const tools: Tools = {
  list: () =>
    Promise.resolve({
      instructions: '',
      tools: [
        {
          name: 'read_note',
          description: 'Reads a note.',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    }),
  context: () => Promise.resolve(''),
  call: (_provider, _mode, name, args): Promise<ToolOutput> => {
    calls.push({ name, args })
    return Promise.resolve({ text: 'Herons stand still.', images: [], error: false })
  },
}

const engine = createApiEngine({
  provider: (id) => (id === PROVIDER.id ? PROVIDER : null),
  tools,
})

async function send(thread: Thread, text: string) {
  const heard: EngineEvent[] = []
  await engine.send(
    thread,
    { text, attachments: [] },
    (event) => heard.push(event),
    new AbortController().signal,
  )
  return heard
}

const CALLED = sse(
  {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: 'The reader wants ', thought: true }] },
      },
    ],
    modelVersion: 'gemini-3-flash',
  },
  {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            { text: 'the note.', thought: true },
            {
              functionCall: { id: 'fc-1', name: 'read_note', args: { path: 'Birds.md' } },
              thoughtSignature: 'c2lnbmVk',
            },
          ],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 9, thoughtsTokenCount: 30 },
  },
)

const ANSWERED = sse(
  { candidates: [{ content: { role: 'model', parts: [{ text: 'Herons ' }] } }] },
  {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: 'stand still.' }] },
        finishReason: 'STOP',
      },
    ],
  },
  {
    candidates: [{ content: { role: 'model', parts: [{ text: '', thoughtSignature: 'ZW5k' }] } }],
    usageMetadata: {
      promptTokenCount: 180,
      cachedContentTokenCount: 100,
      candidatesTokenCount: 4,
    },
  },
)

beforeEach(() => {
  sent = []
  answers = []
  calls.length = 0
  forgetLearnt()
})

describe('the models', () => {
  test('are every page’s chat models, with their windows and Gemini 3’s thinking levels', async () => {
    const models = await catalogue(PROVIDER)
    expect(models.map((one) => one.id)).toEqual(['gemini-3-flash', 'gemini-2.5-flash-lite'])
    expect(models[0]).toMatchObject({
      name: 'Gemini 3 Flash',
      window: 1_048_576,
      output: 65_536,
      thinking: true,
      efforts: ['auto', 'minimal', 'low', 'medium', 'high'],
    })
    expect(models[1]?.efforts).toEqual(['auto'])
    expect(sent.map((one) => one.headers['x-goog-api-key'])).toEqual(['AIza-test', 'AIza-test'])
    expect(sent[0]?.headers.authorization).toBeUndefined()
  })
})

describe('a call made and answered', () => {
  test('runs the call and ends in the words, the thinking shown', async () => {
    answers = [CALLED, ANSWERED]
    const thread = newThread('space', 'gemini', 'gemini-3-flash', 'low', 'full')
    const heard = await send(thread, 'What is in Birds.md?')

    expect(heard.at(-1)).toEqual({ type: 'done', stop: 'end' })
    expect(calls).toEqual([{ name: 'read_note', args: { path: 'Birds.md' } }])
    const model = thread.turns[1]
    expect(model?.parts.map((one) => one.kind)).toEqual(['thinking', 'tool', 'text'])
    expect(model?.parts[0]).toMatchObject({ text: 'The reader wants the note.' })
    expect(model?.parts[2]).toMatchObject({ text: 'Herons stand still.' })
    expect(thread.usage).toMatchObject({ input: 180, cached: 100, output: 4, window: 1_048_576 })
  })

  test('asks the streaming address with the tools, the system and the thinking level', async () => {
    answers = [CALLED, ANSWERED]
    const thread = newThread('space', 'gemini', 'gemini-3-flash', 'low', 'full')
    await send(thread, 'What is in Birds.md?')

    const first = sent.find((one) => one.url.includes(':streamGenerateContent'))
    expect(first?.url).toBe(`${ROOT}/models/gemini-3-flash:streamGenerateContent?alt=sse`)
    expect(first?.headers['x-goog-api-key']).toBe('AIza-test')
    expect(first?.body).toMatchObject({
      systemInstruction: { parts: [{ text: expect.stringContaining('nib') as string }] },
      contents: [{ role: 'user', parts: [{ text: 'What is in Birds.md?' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'read_note',
              description: 'Reads a note.',
              parametersJsonSchema: { type: 'object', properties: { path: { type: 'string' } } },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 65_536,
        thinkingConfig: { includeThoughts: true, thinkingLevel: 'low' },
      },
    })
  })

  test('the second request carries the model’s parts with their signature, then the answer', async () => {
    answers = [CALLED, ANSWERED]
    const thread = newThread('space', 'gemini', 'gemini-3-flash', 'auto', 'full')
    await send(thread, 'What is in Birds.md?')

    const asks = sent.filter((one) => one.url.includes(':streamGenerateContent'))
    const second = asks[1]?.body as { contents: unknown[]; generationConfig: unknown }
    expect(second.contents).toEqual([
      { role: 'user', parts: [{ text: 'What is in Birds.md?' }] },
      {
        role: 'model',
        parts: [
          { text: 'The reader wants the note.', thought: true },
          {
            functionCall: { id: 'fc-1', name: 'read_note', args: { path: 'Birds.md' } },
            thoughtSignature: 'c2lnbmVk',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'fc-1',
              name: 'read_note',
              response: { output: 'Herons stand still.' },
            },
          },
        ],
      },
    ])
    expect(second.generationConfig).toEqual({
      maxOutputTokens: 65_536,
      thinkingConfig: { includeThoughts: true },
    })
  })

  test('the next message replays the turn as Gemini sent it, the last signature kept', async () => {
    answers = [CALLED, ANSWERED, ANSWERED]
    const thread = newThread('space', 'gemini', 'gemini-3-flash', 'auto', 'full')
    await send(thread, 'What is in Birds.md?')
    await send(thread, 'Thanks.')

    const third = sent.filter((one) => one.url.includes(':streamGenerateContent'))[2]?.body as {
      contents: { role: string; parts: unknown[] }[]
    }
    expect(third.contents.map((one) => one.role)).toEqual([
      'user',
      'model',
      'user',
      'model',
      'user',
    ])
    expect(third.contents[3]?.parts).toEqual([
      { text: 'Herons stand still.', thoughtSignature: 'ZW5k' },
    ])
  })

  test('a refusal says Gemini’s own words', async () => {
    answers = [
      () =>
        new Response(
          JSON.stringify({
            error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT' },
          }),
          { status: 400 },
        ),
    ]
    const thread = newThread('space', 'gemini', 'gemini-3-flash', 'auto', 'full')
    const heard = await send(thread, 'Hello')
    expect(heard.at(-1)).toEqual({ type: 'done', stop: 'error', error: 'API key not valid.' })
  })
})

describe('the wire', () => {
  const model: ModelInfo = {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    window: null,
    efforts: ['auto', 'high'],
    images: true,
    fast: false,
  }
  const ask = (change: Partial<Ask> = {}): Ask => ({
    provider: PROVIDER,
    model,
    effort: 'max',
    fast: false,
    system: '',
    tools: [],
    steps: [],
    added: [],
    web: false,
    perMessage: false,
    ...change,
  })

  test('searches the web when asked, and thinks at most high', () => {
    const { body } = gemini.request(ask({ web: true })) as { body: Record<string, unknown> }
    expect(body.tools).toEqual([{ googleSearch: {} }])
    expect(body.generationConfig).toEqual({
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' },
    })
    expect(body.systemInstruction).toBeUndefined()
  })

  test('a model that does not think is asked without thinking', () => {
    const { body } = gemini.request(ask({ model: { ...model, thinking: false } })) as {
      body: Record<string, unknown>
    }
    expect(body.generationConfig).toEqual({})
  })

  test('a call from another provider’s turn goes back unsigned, pictures inline', () => {
    const contents = contentsOf([
      { role: 'user', text: 'Look', images: [{ mime: 'image/png', data: 'iVBO' }] },
      {
        role: 'assistant',
        text: 'Reading.',
        calls: [
          { id: 'toolu_1', name: 'read_note', args: { path: 'a.md' } },
          { id: 'toolu_2', name: 'read_note', args: { path: 'b.md' } },
        ],
      },
      {
        role: 'tool',
        results: [
          { id: 'toolu_1', name: 'read_note', output: { text: 'gone', images: [], error: true } },
          { id: 'toolu_2', name: 'read_note', output: { text: '', images: [], error: false } },
        ],
      },
    ])
    expect(contents[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Look' }, { inlineData: { mimeType: 'image/png', data: 'iVBO' } }],
    })
    expect(contents[1]?.parts).toEqual([
      { text: 'Reading.' },
      {
        functionCall: { id: 'toolu_1', name: 'read_note', args: { path: 'a.md' } },
        thoughtSignature: UNSIGNED,
      },
      { functionCall: { id: 'toolu_2', name: 'read_note', args: { path: 'b.md' } } },
    ])
    expect(contents[2]?.parts).toEqual([
      { functionResponse: { id: 'toolu_1', name: 'read_note', response: { error: 'gone' } } },
      { functionResponse: { id: 'toolu_2', name: 'read_note', response: { output: ' ' } } },
    ])
  })

  test('a call without an id is given one, and sent back without it', () => {
    const reader = gemini.reader(null)
    reader.heard({
      candidates: [
        {
          content: { parts: [{ functionCall: { name: 'read_note', args: {} } }] },
          finishReason: 'STOP',
        },
      ],
    })
    const answer = reader.answer()
    expect(answer.ending).toBe('tool')
    const call = answer.calls[0]
    expect(call?.id).toMatch(/^gemini-call-/)
    const [back] = gemini.results([
      { call: call!, output: { text: 'ok', images: [], error: false } },
    ]) as { parts: { functionResponse: Record<string, unknown> }[] }[]
    expect(back?.parts[0]?.functionResponse).toEqual({
      name: 'read_note',
      response: { output: 'ok' },
    })
  })

  test('a blocked prompt or a safety stop is a refusal, a full answer is cut off', () => {
    const blocked = gemini.reader(null)
    blocked.heard({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })
    expect(blocked.finished(false)).toBe(true)
    expect(blocked.answer()).toMatchObject({ ending: 'refusal', refusal: 'PROHIBITED_CONTENT' })

    const safety = gemini.reader(null)
    safety.heard({ candidates: [{ finishReason: 'SAFETY' }] })
    expect(safety.answer().ending).toBe('refusal')

    const long = gemini.reader(null)
    long.heard({
      candidates: [{ content: { parts: [{ text: 'and' }] }, finishReason: 'MAX_TOKENS' }],
    })
    expect(long.answer().ending).toBe('max_tokens')

    const cut = gemini.reader(null)
    cut.heard({ candidates: [{ content: { parts: [{ text: 'and' }] } }] })
    expect(cut.finished(false)).toBe(false)
  })
})

describe('a one-off question', () => {
  test('streams the words without the thoughts', async () => {
    answers = [
      sse(
        { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: 'A heron.' }] }, finishReason: 'STOP' }] },
      ),
    ]
    const streamed: string[] = []
    const said = await complete({
      provider: PROVIDER,
      model: 'gemini-3-flash',
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'What bird?' },
      ],
      stream: (piece) => streamed.push(piece),
    })
    expect(said).toBe('A heron.')
    expect(streamed).toEqual(['A heron.'])
    expect(sent[0]?.url).toBe(`${ROOT}/models/gemini-3-flash:streamGenerateContent?alt=sse`)
    expect(sent[0]?.body).toEqual({
      systemInstruction: { parts: [{ text: 'Be brief.' }] },
      contents: [{ role: 'user', parts: [{ text: 'What bird?' }] }],
    })
  })
})
