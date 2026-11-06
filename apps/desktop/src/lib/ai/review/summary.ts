import { t } from '../../i18n.svelte'
import { complete } from '../complete'
import type { Message } from '../providers'
import { ai } from '../store.svelte'
import type { Thread, Turn } from '../chat/types'

const KEEP =
  'Summarize this part of a conversation so it can be continued from the summary alone. Keep every note path, page address, decision, change made and still to make, and the reader’s requests, in their own words where they matter. Reply with the summary only.'

function transcriptOf(turns: readonly Turn[]): string {
  const lines: string[] = []
  for (const turn of turns) {
    if (turn.role === 'you') {
      if (turn.draft?.text) lines.push(`Reader: ${turn.draft.text}`)
      continue
    }
    const words = turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('')
    const calls = turn.parts.flatMap((part) => (part.kind === 'tool' ? [part.verb] : []))
    if (calls.length) lines.push(`(used ${calls.join(', ')})`)
    if (words.trim()) lines.push(`Assistant: ${words.trim()}`)
  }
  return lines.join('\n\n')
}

export async function summarized(thread: Thread, turns: readonly Turn[]): Promise<string> {
  const provider = ai.provider(thread.provider)
  if (!provider) throw new Error(t('That provider is not set up yet.'))
  const messages: Message[] = [
    { role: 'system', content: KEEP },
    { role: 'user', content: transcriptOf(turns) },
  ]
  const summary = await complete({ provider, model: thread.model, messages })
  if (!summary.trim()) throw new Error(t('No answer'))
  return summary.trim()
}
