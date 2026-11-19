import { parseQuery } from '@orden/scan/search/query'
import type { Hit } from '@orden/scan/search/match'
import { workspace } from '../../workspace/src/api'

const PROMPT = [
  "You answer questions about the person's own notes, out loud, on a pair of",
  'glasses with seven short lines on them.',
  '',
  'Answer in this shape, always:',
  'first one sentence with the answer, then a blank line, then more detail only if',
  'it is needed.',
  '',
  'Lines from the notes that match the question come with it. Never guess at what',
  'a note says. If the lines do not answer the question, say so in the first',
  'sentence.',
].join('\n')
export const NOT_SET = 'AI is not set up. Choose a default account in Settings, AI.'
const LINES = 40
export async function answerOf(question: string): Promise<string> {
  const { ai, complete } = await import('../../ai-providers/src/api')
  const provider = ai.providerFor('ask')
  if (!provider) return NOT_SET
  const found = await linesFor(question)
  const answer = await complete({
    provider,
    model: provider.model,
    messages: [
      { role: 'system', content: PROMPT },
      { role: 'user', content: found ? `${question}\n\nFrom the notes:\n${found}` : question },
    ],
  })
  return answer.trim()
}
async function linesFor(question: string): Promise<string> {
  const root = workspace.activeSpace?.root
  const words = question.split(/[^\p{L}\p{N}]+/u).filter((one) => one.length > 2)
  if (!root || !words.length) return ''
  const { searchSpace } = await import('../../search/src/api')
  const hits: Hit[] = []
  await searchSpace(
    root,
    parseQuery(words.join(' OR ')),
    words,
    LINES,
    (batch) => hits.push(...batch.hits),
    workspace.leftOutOf(root),
  )
  return hits
    .slice(0, LINES)
    .map((one) => `${one.name}: ${one.text}`)
    .join('\n')
}
