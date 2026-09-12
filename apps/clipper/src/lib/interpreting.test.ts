import { beforeEach, describe, expect, test, vi } from 'vitest'
import { NO_INTERPRETER } from './interpret/setup'
import { MOST_CHARACTERS } from './interpret/prompt'
import { filledQuietly, pageOf } from './interpreting'
import type { Clip } from './messages'

function clip(over: Partial<Clip> = {}): Clip {
  return {
    origin: { kind: 'page', url: 'https://blog.example/hello', title: 'A title', tags: [] },
    clipped: '2026-03-04T09:12:00.000Z',
    markdown: 'The article itself.',
    images: [],
    filled: [],
    ...over,
  }
}

/** A provider that answers, and a count of how often it was asked. */
function provider(reply: string) {
  const fetching = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: reply } }] })),
    }),
  )

  vi.stubGlobal('fetch', fetching)
  return fetching
}

/** A provider set up and switched on for the template an ordinary page claims. */
const READY = {
  ...NO_INTERPRETER,
  provider: 'compatible' as const,
  models: { compatible: 'a-model' },
  on: { Article: true },
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('the page as the interpreter is given it', () => {
  test('is the article, not the tab', () => {
    expect(pageOf(clip()).text).toBe('The article itself.')
  })

  test('says where the page is and what it called itself', () => {
    const one = pageOf(clip())

    expect(one.url).toBe('https://blog.example/hello')
    expect(one.title).toBe('A title')
  })

  test('is trimmed, so a book of an article is not a book of a request', () => {
    expect(pageOf(clip({ markdown: 'a'.repeat(MOST_CHARACTERS * 3) })).text).toHaveLength(
      MOST_CHARACTERS,
    )
  })
})

describe('a clip nobody is watching', () => {
  test('is interpreted by the template its address claims', async () => {
    provider('{"author": "A. Writer"}')

    expect(await filledQuietly(clip(), READY)).toEqual([{ key: 'author', value: 'A. Writer' }])
  })

  test('sends nothing at all with the switch off for that template', async () => {
    const fetching = provider('{"author": "A. Writer"}')

    expect(await filledQuietly(clip(), { ...READY, on: {} })).toEqual([])
    expect(fetching).not.toHaveBeenCalled()
  })

  test('sends nothing at all with no provider chosen', async () => {
    const fetching = provider('{"author": "A. Writer"}')

    expect(await filledQuietly(clip(), { ...NO_INTERPRETER, on: { Article: true } })).toEqual([])
    expect(fetching).not.toHaveBeenCalled()
  })

  test('minds the switch for the template the address claims and not another', async () => {
    const fetching = provider('{"author": "A. Writer"}')
    const paper = clip({
      origin: { kind: 'page', url: 'https://arxiv.org/abs/2401.1', title: 'A', tags: [] },
    })

    expect(await filledQuietly(paper, READY)).toEqual([])
    expect(fetching).not.toHaveBeenCalled()
  })

  test('keeps the note when the provider fails, since the clip is already in hand', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('failed to fetch'))),
    )

    expect(await filledQuietly(clip(), READY)).toEqual([])
  })
})
