import { describe, expect, test, vi } from 'vitest'
import { askAbout, type Found, type Notes, transcribeWith } from './ask'
import { chosenOf, EFFORTS, isEffort } from './models'

/** A model that answers from a script, and writes down what it was sent.
 *
 *  Shaped like the live endpoint, whose replies were checked against it on
 *  2026-09-09: a call is an output item of type `function_call` with a `call_id`,
 *  and text is in `output[].content[].text`. */
function model(turns: readonly unknown[]) {
  const sent: unknown[] = []
  let at = 0

  const send = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? '{}')))
    const body = turns[Math.min(at++, turns.length - 1)]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  return { send: send as unknown as typeof fetch, sent }
}

const says = (text: string) => ({
  output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
})

const calls = (name: string, args: Record<string, unknown>, id = 'call_1') => ({
  output: [{ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }],
})

function notes(over: Partial<Notes> = {}): Notes {
  return {
    search: async (query) =>
      query.includes('font')
        ? ([{ note: 'Glasses', line: 12, text: 'Decided: the firmware font only.' }] as Found[])
        : [],
    read: async (name) => (name === 'Glasses' ? '# Glasses\n\nThe firmware font only.\n' : null),
    ...over,
  }
}

const asking = (send: typeof fetch, over: Partial<Parameters<typeof askAbout>[1]> = {}) => ({
  key: 'sk-test',
  model: 'gpt-6-astra',
  effort: 'low' as const,
  notes: notes(),
  fetch: send,
  ...over,
})

describe('a question to the model', () => {
  test('answers with what the model said', async () => {
    const { send } = model([says('The firmware font only.\n\nDecided on 2026-09-08.')])

    const answer = await askAbout('what did I decide about the font', asking(send))

    expect(answer).toBe('The firmware font only.\n\nDecided on 2026-09-08.')
  })

  test('sends no notes at all until the model asks for one', async () => {
    const { send, sent } = model([says('nothing to say')])

    await askAbout('anything', asking(send))
    const first = sent[0] as { input: { role?: string; content?: string }[] }

    // Two items: what it is for, and the question. Not one line of a note.
    expect(first.input).toHaveLength(2)
    expect(first.input[0]?.role).toBe('developer')
    expect(first.input[1]?.content).toBe('anything')
  })

  test('demands the answer in one sentence first', async () => {
    const { send, sent } = model([says('ok')])

    await askAbout('anything', asking(send))
    const first = sent[0] as { input: { content?: string }[] }

    expect(first.input[0]?.content).toContain('first one sentence with the answer')
    expect(first.input[0]?.content).toContain('blank line')
  })

  test('offers exactly the two tools, and asks the model to use them', async () => {
    const { send, sent } = model([says('ok')])

    await askAbout('anything', asking(send))
    const first = sent[0] as { tools: { name: string }[] }

    expect(first.tools.map((one) => one.name)).toEqual(['search_notes', 'read_note'])
  })

  test('searches the notes when the model asks, and answers with what it found', async () => {
    const { send, sent } = model([calls('search_notes', { query: 'font' }), says('The font.')])

    const answer = await askAbout('what about the font', asking(send))
    const second = sent[1] as { input: Record<string, unknown>[] }

    expect(answer).toBe('The font.')
    const output = second.input.find((one) => one.type === 'function_call_output')
    expect(output?.call_id).toBe('call_1')
    expect(String(output?.output)).toContain('the firmware font only')
  })

  test('reads a note when the model asks for one', async () => {
    const { send, sent } = model([calls('read_note', { name: 'Glasses' }), says('done')])

    await askAbout('read it', asking(send))
    const second = sent[1] as { input: Record<string, unknown>[] }
    const output = second.input.find((one) => one.type === 'function_call_output')

    expect(String(output?.output)).toContain('The firmware font only.')
  })

  test('tells the model when a search found nothing', async () => {
    const { send, sent } = model([
      calls('search_notes', { query: 'weather' }),
      says('I cannot say.'),
    ])

    await askAbout('the weather', asking(send))
    const second = sent[1] as { input: Record<string, unknown>[] }

    expect(second.input.find((one) => one.type === 'function_call_output')?.output).toBe(
      'nothing found',
    )
  })

  test('tells the model when there is no such note', async () => {
    const { send, sent } = model([calls('read_note', { name: 'Nowhere' }), says('no')])

    await askAbout('read it', asking(send))
    const second = sent[1] as { input: Record<string, unknown>[] }

    expect(second.input.find((one) => one.type === 'function_call_output')?.output).toBe(
      'no such note',
    )
  })

  test('cuts a note far longer than a model needs, and says it was cut', async () => {
    const long = 'x'.repeat(40_000)
    const { send, sent } = model([calls('read_note', { name: 'Long' }), says('ok')])

    await askAbout('read it', asking(send, { notes: notes({ read: async () => long }) }))
    const second = sent[1] as { input: Record<string, unknown>[] }
    const output = String(second.input.find((one) => one.type === 'function_call_output')?.output)

    expect(output.length).toBeLessThan(long.length)
    expect(output).toContain('cut here')
  })

  test('keeps the whole conversation, round after round', async () => {
    const { send, sent } = model([
      calls('search_notes', { query: 'font' }, 'a'),
      calls('read_note', { name: 'Glasses' }, 'b'),
      says('At last.'),
    ])

    const answer = await askAbout('go', asking(send))

    expect(answer).toBe('At last.')
    const third = sent[2] as { input: Record<string, unknown>[] }
    // The question, both calls, and both answers.
    expect(third.input.filter((one) => one.type === 'function_call')).toHaveLength(2)
    expect(third.input.filter((one) => one.type === 'function_call_output')).toHaveLength(2)
  })

  test('stops asking for notes after four rounds', async () => {
    const { send } = model([calls('search_notes', { query: 'again' })])

    await askAbout('go round for ever', asking(send))

    // Five requests: four rounds of tools and the round that has to answer.
    expect(send).toHaveBeenCalledTimes(5)
  })

  test('says what the API said when it refuses', async () => {
    const { send } = model([{ error: { message: 'Incorrect API key provided' } }])

    await expect(askAbout('anything', asking(send))).rejects.toThrow('Incorrect API key')
  })

  test('refuses to ask at all with no key or no model', async () => {
    const { send } = model([says('ok')])

    await expect(askAbout('q', asking(send, { key: '' }))).rejects.toThrow('no key')
    await expect(askAbout('q', asking(send, { model: '' }))).rejects.toThrow('no model')
  })

  test('survives a model that sent arguments which are not JSON', async () => {
    const { send, sent } = model([
      {
        output: [{ type: 'function_call', call_id: 'x', name: 'search_notes', arguments: 'oops' }],
      },
      says('never mind'),
    ])

    const answer = await askAbout('go', asking(send))
    const second = sent[1] as { input: Record<string, unknown>[] }

    expect(answer).toBe('never mind')
    expect(second.input.find((one) => one.type === 'function_call_output')?.output).toBe('no query')
  })

  test('sends the reasoning effort the reader chose', async () => {
    const { send, sent } = model([says('ok')])

    await askAbout('q', asking(send, { effort: 'high' }))

    expect((sent[0] as { reasoning: { effort: string } }).reasoning.effort).toBe('high')
  })
})

/** Which models are offered, out of the hundred and twenty five the endpoint lists. */
describe('the models on offer', () => {
  const listed = (ids: string[]) => ({ data: ids.map((id) => ({ id })) })

  test('offers the four families, newest first', () => {
    // What the live endpoint answered on 2026-09-09, in part.
    const ids = chosenOf(
      listed([
        'whisper-1',
        'gpt-5.6-terra',
        'text-embedding-3-small',
        'gpt-6-astra',
        'gpt-5.6-luna',
        'gpt-4o-mini-transcribe',
        'gpt-5.6-sol',
        'gpt-5.4-nano',
      ]),
    )

    expect(ids).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra'])
  })

  test('leaves out the dated snapshots, which pin a reader to a model for ever', () => {
    expect(chosenOf(listed(['gpt-6-astra-2026-09-01', 'gpt-6-astra']))).toEqual(['gpt-6-astra'])
    expect(chosenOf(listed(['gpt-6-astra-2026-09-01']))).toEqual([])
  })

  test('prefers the alias over a variant of it', () => {
    expect(chosenOf(listed(['gpt-6-astra-preview-astra', 'gpt-6-astra']))).toEqual(['gpt-6-astra'])
  })

  test('answers with nothing rather than throwing on a body it cannot read', () => {
    expect(chosenOf(null)).toEqual([])
    expect(chosenOf({})).toEqual([])
    expect(chosenOf({ data: 'no' })).toEqual([])
    expect(chosenOf({ data: [1, null, { id: 5 }] })).toEqual([])
  })

  test('knows the efforts the API takes, and refuses one it does not', () => {
    // Read off the error the API answers an invalid effort with, so this is the
    // API's own list rather than a guess.
    expect(EFFORTS).toContain('minimal')
    expect(EFFORTS).toContain('max')
    expect(isEffort('high')).toBe(true)
    expect(isEffort('banana')).toBe(false)
    expect(isEffort(4)).toBe(false)
  })
})

describe('turning an utterance into words', () => {
  test('sends a wav and answers with what came back', async () => {
    const send = vi.fn(async () => new Response('open page four', { status: 200 }))
    const said = await transcribeWith(
      new Uint8Array(64),
      'sk-test',
      'gpt-transcribe',
      send as unknown as typeof fetch,
    )

    expect(said).toBe('open page four')
  })

  test('answers with nothing when the endpoint refused, rather than throwing', async () => {
    const send = vi.fn(async () => new Response('no', { status: 401 }))

    await expect(
      transcribeWith(new Uint8Array(8), 'sk-test', 'whisper-1', send as unknown as typeof fetch),
    ).resolves.toBeNull()
  })

  test('does not try at all without a key', async () => {
    const send = vi.fn()

    expect(
      await transcribeWith(new Uint8Array(8), '', 'whisper-1', send as unknown as typeof fetch),
    ).toBeNull()
    expect(send).not.toHaveBeenCalled()
  })
})
