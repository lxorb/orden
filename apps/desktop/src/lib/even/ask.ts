/** A question to a model, with the account's notes as tools.
 *
 *  Said out loud after the word "question" and answered on the glasses. The whole
 *  of the design is in three decisions:
 *
 *  1. **The request is made from the plugin.** The key is the account's own and
 *     goes from the phone to `api.openai.com` and nowhere else: not through Nib's
 *     own Worker, not through anything of ours. There is nothing in the middle to
 *     trust.
 *  2. **Nothing is stuffed into the context.** The model is given two tools and no
 *     notes at all: `search_notes` to find something and `read_note` to read it.
 *     A question about one note therefore costs one note, and a reader with four
 *     hundred of them is not paying to send four hundred.
 *  3. **The answer is one sentence first.** A panel is seven lines and a reader is
 *     walking: the first line has to be the answer, and the detail after a blank
 *     line is for the reader who scrolls.
 *
 *  Written against the Responses API, whose shapes were checked against the live
 *  endpoint on 2026-09-09: a tool is `{ type: 'function', name, parameters,
 *  strict }`, a call comes back as an output item of type `function_call` with a
 *  `call_id`, and the answer to it goes back as an input item of type
 *  `function_call_output`. The text of a reply is in `output[].content[].text`
 *  where the content's type is `output_text`. */

import { type Effort, OPENAI } from './models'

/** What one note looked like to a search. */
export interface Found {
  note: string
  line: number
  text: string
}

/** The account's own notes, as the two tools see them. Handed in, so that the flow
 *  can be tested against a model that is a function and notes that are an array. */
export interface Notes {
  /** Every note whose words match, across every space the account has. */
  search: (query: string) => Promise<Found[]>
  /** One note, by the name the search gave. Null when there is no such note, which
   *  the model is told rather than being left to guess. */
  read: (name: string) => Promise<string | null>
}

/** What the model needs to know before it answers.
 *
 *  Short on purpose. A long prompt on a panel of seven lines is a long prompt
 *  spent teaching the model to write for a screen it will never see. */
const PROMPT = [
  "You answer questions about the person's own notes, out loud, on a pair of",
  'glasses with seven short lines on them.',
  '',
  'Answer in this shape, always:',
  'first one sentence with the answer, then a blank line, then more detail only if',
  'it is needed.',
  '',
  'Use search_notes to find what you need and read_note to read it. Never guess at',
  'what a note says. If the notes do not answer the question, say so in the first',
  'sentence.',
].join('\n')

/** The two tools, as the API takes them. */
const TOOLS = [
  {
    type: 'function',
    name: 'search_notes',
    description: "Search every note in the person's account. Answers matching lines.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to look for.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'read_note',
    description: 'Read one whole note, by the name a search gave.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name of the note.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    strict: true,
  },
] as const

/** How many rounds of tool calls are allowed before the answer has to come.
 *
 *  Four. A question about the notes is a search and a read, and a model that has
 *  not answered after four is a model in a loop; the reader is standing there. */
const ROUNDS = 4

/** How much of a note the model is given at once.
 *
 *  Twelve thousand characters, which is a long note and a small fraction of any
 *  model's window. A note longer than that is cut rather than refused, and the
 *  model is told it was cut so that it does not report the ending of something it
 *  did not see. */
const MOST = 12_000

/** How many matching lines a search answers with. */
const HITS = 20

/** What the plugin sends and what came back, kept to what is used. */
interface Call {
  id: string
  name: string
  arguments: string
}

/** How a question is asked. */
export interface Asking {
  key: string
  model: string
  effort: Effort
  notes: Notes
  /** Handed in so a test can answer without a network, and so the one place a
   *  request is made is visible from here. */
  fetch?: typeof fetch
}

/** Every message of the conversation so far. Plain objects rather than a type from
 *  a package: this is a wire format and it is written out where it is read. */
type Item = Record<string, unknown>

/** The text of a reply, and the calls it wants made. Read field by field, because
 *  this is JSON from somebody else's server. */
function readReply(body: unknown): { text: string; calls: Call[]; refused: string } {
  const out: { text: string; calls: Call[]; refused: string } = { text: '', calls: [], refused: '' }
  if (typeof body !== 'object' || body === null) return out

  const error = (body as { error?: unknown }).error
  if (typeof error === 'object' && error !== null) {
    const said = (error as { message?: unknown }).message
    out.refused = typeof said === 'string' ? said : 'refused'
    return out
  }

  const output = (body as { output?: unknown }).output
  if (!Array.isArray(output)) return out

  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue

    const one = item as Record<string, unknown>
    if (one.type === 'function_call') {
      const id = typeof one.call_id === 'string' ? one.call_id : ''
      const name = typeof one.name === 'string' ? one.name : ''
      const args = typeof one.arguments === 'string' ? one.arguments : '{}'
      if (id && name) out.calls.push({ id, name, arguments: args })
      continue
    }

    const content = one.content
    if (!Array.isArray(content)) continue

    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue

      const piece = part as Record<string, unknown>
      if (piece.type === 'output_text' && typeof piece.text === 'string') out.text += piece.text
    }
  }

  return out
}

/** One field of a tool call's arguments, which arrive as a JSON string. */
function argument(call: Call, name: string): string {
  try {
    const parsed: unknown = JSON.parse(call.arguments)
    if (typeof parsed !== 'object' || parsed === null) return ''

    const found = (parsed as Record<string, unknown>)[name]
    return typeof found === 'string' ? found : ''
  } catch {
    // A model that sent something that is not JSON has asked for nothing, and the
    // empty answer below tells it so.
    return ''
  }
}

/** What a tool answers, as the string the model is handed. */
async function answer(call: Call, notes: Notes): Promise<string> {
  if (call.name === 'search_notes') {
    const query = argument(call, 'query')
    if (!query) return 'no query'

    const found = await notes.search(query)
    if (!found.length) return 'nothing found'
    return JSON.stringify(found.slice(0, HITS))
  }

  if (call.name === 'read_note') {
    const name = argument(call, 'name')
    if (!name) return 'no name'

    const text = await notes.read(name)
    if (text === null) return 'no such note'
    // Said rather than silently cut, so the model does not report the end of
    // something it was never shown.
    return text.length > MOST ? `${text.slice(0, MOST)}\n\n[cut here; the note goes on]` : text
  }

  return 'no such tool'
}

/** The question, asked and answered.
 *
 *  Throws only what the caller has to say out loud - no key, no model, a refusal
 *  from the API - because the reader is standing there and a silent failure is a
 *  pair of glasses that ignored them. */
export async function askAbout(question: string, asking: Asking): Promise<string> {
  if (!asking.key) throw new Error('no key')
  if (!asking.model) throw new Error('no model')

  const send = asking.fetch ?? fetch
  const items: Item[] = [
    { role: 'developer', content: PROMPT },
    { role: 'user', content: question },
  ]

  for (let round = 0; round <= ROUNDS; round++) {
    const answered = await send(`${OPENAI}/v1/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${asking.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: asking.model,
        input: items,
        reasoning: { effort: asking.effort },
        tools: TOOLS,
        // Enough for a sentence and a few paragraphs after it. A panel holds seven
        // lines and the reader scrolls; a thousand words is nobody's answer.
        max_output_tokens: 1200,
      }),
    })

    const body: unknown = await answered.json().catch(() => null)
    const reply = readReply(body)
    if (reply.refused) throw new Error(reply.refused)
    if (!answered.ok) throw new Error(`the model answered ${String(answered.status)}`)

    // The last round is the answer whatever else it wanted: a model still asking
    // for notes after four rounds is not going to stop.
    if (!reply.calls.length || round === ROUNDS) return reply.text.trim()

    for (const call of reply.calls) {
      items.push({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      })
      items.push({
        type: 'function_call_output',
        call_id: call.id,
        output: await answer(call, asking.notes),
      })
    }
  }

  return ''
}

/** The models that turn sound into words, in the order they are tried.
 *
 *  Verified against `GET /v1/models` on 2026-09-09. The first that the account
 *  actually has is used; `whisper-1` has been there for years and is the floor. */
export const TRANSCRIBERS = ['gpt-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'] as const

/** One utterance, as words.
 *
 *  Only reached where the WebView has no recogniser of its own; see voice.ts. The
 *  file is a WAV built out of the frames the glasses sent, which every
 *  transcription endpoint takes. */
export async function transcribeWith(
  wav: Uint8Array<ArrayBuffer>,
  key: string,
  model: string,
  send: typeof fetch = fetch,
): Promise<string | null> {
  if (!key) return null

  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'said.wav')
  form.append('model', model)
  // A command is English or the reader's own language; left to the model, which
  // does better at guessing than a setting nobody will find.
  form.append('response_format', 'text')

  const answered = await send(`${OPENAI}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  })
  if (!answered.ok) return null

  const said = await answered.text()
  return said.trim() || null
}
