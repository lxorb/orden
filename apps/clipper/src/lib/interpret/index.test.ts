import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PROBLEMS } from '../problems'
import { interpret, modelsOf, ollamaModels } from './index'
import type { Page } from './prompt'
import { OLLAMA, type Setup } from './providers'
import type { Template } from './templates'

const PAGE: Page = { url: 'https://site.example/a', title: 'A', text: 'The article.' }

const TEMPLATE: Template = {
  name: 'Article',
  when: ['*'],
  fields: [
    { key: 'author', says: 'Who wrote it', list: false },
    { key: 'tags', says: 'A few topics', list: true },
  ],
}

function setup(over: Partial<Setup> = {}): Setup {
  return { provider: 'compatible', key: '', address: OLLAMA, model: 'a-model', ...over }
}

/** One answer for the next request, as a real `fetch` would give it. */
function answers(...replies: { status?: number; body: unknown }[]) {
  const sent: { url: string; body: unknown }[] = []
  let at = 0

  const fetching = vi.fn((url: string, init?: RequestInit) => {
    const source = typeof init?.body === 'string' ? init.body : '{}'
    sent.push({ url, body: JSON.parse(source) as unknown })

    const reply = replies[Math.min(at++, replies.length - 1)]
    return Promise.resolve({
      ok: (reply?.status ?? 200) < 400,
      status: reply?.status ?? 200,
      text: () => Promise.resolve(JSON.stringify(reply?.body ?? {})),
    })
  })

  vi.stubGlobal('fetch', fetching)
  return { sent, fetching }
}

/** What an OpenAI-compatible server says when it has answered the question. */
function said(text: string) {
  return { body: { choices: [{ message: { content: text } }] } }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('one page interpreted', () => {
  test('is the properties the model filled in', async () => {
    answers(said('{"author": "A. Writer", "tags": ["one", "two"]}'))

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({
      filled: [
        { key: 'author', value: 'A. Writer' },
        { key: 'tags', value: ['one', 'two'] },
      ],
    })
  })

  test('sends the page and the questions the template names and nothing else', async () => {
    const { sent } = answers(said('{}'))
    await interpret(PAGE, TEMPLATE, setup())

    const body = sent[0]?.body as { messages: { content: string }[] }
    const asked = body.messages.at(-1)?.content ?? ''

    expect(sent).toHaveLength(1)
    expect(asked).toContain('The article.')
    expect(asked).toContain('author: Who wrote it')
    expect(asked).toContain('tags[]: A few topics')
  })

  test('asks nothing at all of a provider that is not set up', async () => {
    const { fetching } = answers(said('{}'))

    expect(await interpret(PAGE, TEMPLATE, setup({ model: '' }))).toEqual({ filled: [] })
    expect(fetching).not.toHaveBeenCalled()
  })

  test('asks nothing at all for a template with nothing to fill in', async () => {
    const { fetching } = answers(said('{}'))
    const bare = { ...TEMPLATE, fields: [] }

    expect(await interpret(PAGE, bare, setup())).toEqual({ filled: [] })
    expect(fetching).not.toHaveBeenCalled()
  })
})

describe('when the provider will not play', () => {
  test('a server that does not know JSON mode is asked again without it', async () => {
    const { sent } = answers(
      { status: 400, body: { error: { message: 'unknown field response_format' } } },
      said('{"author": "A"}'),
    )

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({
      filled: [{ key: 'author', value: 'A' }],
    })

    const first = sent[0]?.body as Record<string, unknown>
    const second = sent[1]?.body as Record<string, unknown>

    expect(first.response_format).toEqual({ type: 'json_object' })
    expect('response_format' in second).toBe(false)
  })

  test('a refusal it repeats comes back in its own words', async () => {
    const { sent } = answers({ status: 400, body: { error: { message: 'no such model' } } })

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({ problem: 'no such model' })
    expect(sent).toHaveLength(2)
  })

  test('a refusal it explains is handed on in its own words', async () => {
    answers({ status: 401, body: { error: { message: 'incorrect api key' } } })

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({ problem: 'incorrect api key' })
  })

  test('a refusal it does not explain is one sentence of ours', async () => {
    answers({ status: 503, body: 'Service Unavailable' })

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({ problem: PROBLEMS.provider })
  })

  test('a network that is not there is not a problem for the clip', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('failed to fetch'))),
    )

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({ problem: PROBLEMS.provider })
  })

  test('an answer that is not properties says so rather than filling nothing in', async () => {
    answers(said('I could not read that page.'))

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({ problem: PROBLEMS.unreadable })
  })

  test('an answer with no message in it says the same', async () => {
    answers({ body: { choices: [] } })

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({ problem: PROBLEMS.unreadable })
  })

  test('a page the model found none of the properties in is not a failure', async () => {
    answers(said('{}'))

    expect(await interpret(PAGE, TEMPLATE, setup())).toEqual({ filled: [] })
  })
})

describe('giving up on an answer', () => {
  test('the request carries the signal it was given', async () => {
    const { fetching } = answers(said('{}'))
    const stop = new AbortController()

    await interpret(PAGE, TEMPLATE, setup(), stop.signal)

    const init = fetching.mock.calls[0]?.[1]
    expect(init?.signal).toBe(stop.signal)
  })

  test('a request already given up on reads as a provider that said nothing', async () => {
    const stop = new AbortController()
    stop.abort()

    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) =>
        init?.signal?.aborted
          ? Promise.reject(new Error('aborted'))
          : Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') }),
      ),
    )

    expect(await interpret(PAGE, TEMPLATE, setup(), stop.signal)).toEqual({
      problem: PROBLEMS.provider,
    })
  })
})

describe('what models there are', () => {
  test('is what the provider listed', async () => {
    answers({ body: { data: [{ id: 'one' }, { id: 'two' }] } })

    expect(await modelsOf(setup())).toEqual(['one', 'two'])
  })

  test('is nothing from a provider that will not say, rather than a failure', async () => {
    answers({ status: 404, body: {} })
    expect(await modelsOf(setup())).toEqual([])

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('failed to fetch'))),
    )
    expect(await modelsOf(setup())).toEqual([])
  })
})

describe('looking for a model on this machine', () => {
  test('finds what Ollama has, at the address Ollama answers on', async () => {
    const { sent } = answers({ body: { data: [{ id: 'llama3' }] } })

    expect(await ollamaModels()).toEqual(['llama3'])
    expect(sent[0]?.url).toBe(`${OLLAMA}/models`)
  })

  test('finds nothing rather than an empty list when nothing answers there', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('failed to fetch'))),
    )

    expect(await ollamaModels()).toBe(null)
  })

  test('tells a server with nothing pulled yet apart from no server at all', async () => {
    answers({ body: { data: [] } })

    expect(await ollamaModels()).toEqual([])
  })
})
