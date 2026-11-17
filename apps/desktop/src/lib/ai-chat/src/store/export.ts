import { linkedAnswer } from '../retrieve'
import type { Thread } from '../../../ai-providers/src/api'
import { sourcesFor } from './citations'

function quoted(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

function answerOf(thread: Thread, at: number): string {
  const turn = thread.turns[at]
  const words = (turn?.parts ?? [])
    .flatMap((part) => (part.kind === 'text' ? [part.text] : []))
    .join('')
    .trim()
  return linkedAnswer(words, sourcesFor(thread.turns, at))
}

export function threadMarkdown(thread: Thread, untitled: string): string {
  const blocks = [`# ${thread.title.trim() || untitled}`]
  thread.turns.forEach((turn, at) => {
    if (turn.role === 'you') {
      const text = turn.draft?.text ?? ''
      if (text.trim()) blocks.push(quoted(text))
      return
    }
    const words = answerOf(thread, at)
    if (words) blocks.push(words)
  })
  return `${blocks.join('\n\n')}\n`
}
