import { OPENAI } from './models'
import { type Found, readNote, searchNotes } from './notes'
import type { Effort, Env } from '../../../sync-server/src/api'

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

const ROUNDS = 4

const MOST = 12_000

interface Call {
  id: string
  name: string
  arguments: string
}

type Item = Record<string, unknown>

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

function argument(call: Call, name: string): string {
  try {
    const parsed: unknown = JSON.parse(call.arguments)
    if (typeof parsed !== 'object' || parsed === null) return ''

    const found = (parsed as Record<string, unknown>)[name]
    return typeof found === 'string' ? found : ''
  } catch {
    return ''
  }
}

async function answer(env: Env, userId: string, call: Call): Promise<string> {
  if (call.name === 'search_notes') {
    const query = argument(call, 'query')
    if (!query) return 'no query'

    const found: Found[] = await searchNotes(env, userId, query)
    if (!found.length) return 'nothing found'
    return JSON.stringify(found)
  }

  if (call.name === 'read_note') {
    const name = argument(call, 'name')
    if (!name) return 'no name'

    const text = await readNote(env, userId, name)
    if (text === null) return 'no such note'
    return text.length > MOST ? `${text.slice(0, MOST)}\n\n[cut here; the note goes on]` : text
  }

  return 'no such tool'
}

export async function askAbout(
  env: Env,
  userId: string,
  question: string,
  asking: { key: string; model: string; effort: Effort },
): Promise<string> {
  const items: Item[] = [
    { role: 'developer', content: PROMPT },
    { role: 'user', content: question },
  ]

  for (let round = 0; round <= ROUNDS; round++) {
    const answered = await fetch(`${OPENAI}/v1/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${asking.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: asking.model,
        input: items,
        reasoning: { effort: asking.effort },
        tools: TOOLS,
        max_output_tokens: 1200,
      }),
    })

    const body: unknown = await answered.json().catch(() => null)
    const reply = readReply(body)
    if (reply.refused) throw new Error(reply.refused)
    if (!answered.ok) throw new Error(`the model answered ${String(answered.status)}`)

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
        output: await answer(env, userId, call),
      })
    }
  }

  return ''
}
