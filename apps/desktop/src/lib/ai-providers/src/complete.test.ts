import { beforeEach, describe, expect, test, vi } from 'vitest'

let key = ''

vi.mock('./keys', () => ({ readKey: () => Promise.resolve(key) }))

const sent: string[] = []

const said = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: 'said' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

let answer = said

vi.stubGlobal('fetch', (url: string) => {
  sent.push(url)
  return Promise.resolve(answer())
})

const { complete, listModels } = await import('./complete')

const HOSTED = { id: 'openai', name: 'OpenAI', kind: 'openai' as const, model: 'gpt-5' }
const OWN = {
  id: 'compatible-1',
  name: 'On this machine',
  kind: 'compatible' as const,
  model: 'llama',
  baseUrl: 'http://localhost:11434',
}

const ASKED = { messages: [{ role: 'user' as const, content: 'the whole note' }] }

beforeEach(() => {
  sent.length = 0
  key = ''
  answer = said
})

describe('a provider with no key on this device', () => {
  test('is not asked anything at all', async () => {
    await expect(complete({ provider: HOSTED, model: HOSTED.model, ...ASKED })).rejects.toThrow(
      /not set up/,
    )
    expect(sent).toEqual([])
  })

  test('and is not asked for its models either', async () => {
    await expect(listModels(HOSTED)).rejects.toThrow(/not set up/)
    expect(sent).toEqual([])
  })

  test('while a model on this machine wants none', async () => {
    expect(await complete({ provider: OWN, model: OWN.model, ...ASKED })).toBe('said')
    expect(sent).toEqual(['http://localhost:11434/v1/chat/completions'])
  })
})

describe('a provider with a key', () => {
  test('is asked', async () => {
    key = 'sk-test'

    expect(await complete({ provider: HOSTED, model: HOSTED.model, ...ASKED })).toBe('said')
    expect(sent).toEqual(['https://api.openai.com/v1/chat/completions'])
  })
})

describe('a streamed answer', () => {
  test('keeps its last line, though no line break follows it', async () => {
    const line = (text: string) =>
      `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`
    answer = () => new Response(`${line('one ')}\n${line('two')}`, { status: 200 })
    const pieces: string[] = []
    const whole = await complete({
      provider: OWN,
      model: OWN.model,
      ...ASKED,
      stream: (piece) => pieces.push(piece),
    })
    expect(whole).toBe('one two')
    expect(pieces).toEqual(['one ', 'two'])
  })
})
