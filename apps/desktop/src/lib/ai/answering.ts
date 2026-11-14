import type { AiAsk } from '@orden/editor'
import { TexDelimiters } from '@orden/markdown/streamed'
import { busy, message } from '../ui-kit/src/api'
import { complete, wasStopped } from './complete'
import { ai } from './store.svelte'

const SYSTEM = [
  'You are answering inside a markdown note, and your answer is written straight',
  'into it. Reply in markdown, in the same language the question is written in.',
  'No preamble, no sign-off, and never wrap the whole reply in a code fence.',
  'Write maths as $…$ inline and $$…$$ on lines of their own.',
].join(' ')

function noteContext(note: string): string {
  return `The note this question is in:\n\n<note>\n${note}\n</note>`
}

export async function answer(ask: AiAsk, signal: AbortSignal) {
  const provider = ai.providerFor('block')
  if (!provider) {
    busy.failed('Add an AI provider in Settings first.')
    throw new Error('no provider')
  }

  const began = { yet: false, model: provider.model }
  const write = (piece: string) => {
    if (!piece) return
    if (!began.yet) {
      began.yet = true
      ask.started(began.model)
    }
    ask.wrote(piece)
  }
  const spelling = new TexDelimiters()
  const wrote = (piece: string) => write(spelling.push(piece))

  try {
    await complete({
      provider,
      model: provider.model,
      messages: [
        { role: 'system', content: SYSTEM },
        ...(ask.note ? [{ role: 'system' as const, content: noteContext(ask.note) }] : []),
        { role: 'user', content: ask.prompt },
      ],
      stream: wrote,
      named: (model) => {
        began.model = model
      },
      signal,
    })
    write(spelling.end())

    if (!began.yet) busy.failed('The model did not answer.')
  } catch (error) {
    if (began.yet) write(spelling.end())
    if (!wasStopped(error)) busy.failed(message(error, 'The model did not answer.'))
    throw error
  }
}
