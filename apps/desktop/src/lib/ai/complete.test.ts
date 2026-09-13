/** What leaves this machine, and what does not.
 *
 *  A request carries the prompt and, where the fence asked for it, the whole note.
 *  So the one thing worth a test here is the gate in front of it: a hosted provider
 *  with no key on the device can only answer 401, and by the time it does the note
 *  has already left. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

/** What the device's store answers for a key, which each test sets. */
let key = ''

vi.mock('./keys', () => ({ readKey: () => Promise.resolve(key) }))

/** Every request the module made, and what a provider answers when it does. */
const sent: string[] = []

vi.stubGlobal('fetch', (url: string) => {
  sent.push(url)
  return Promise.resolve(
    new Response(JSON.stringify({ choices: [{ message: { content: 'said' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
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
