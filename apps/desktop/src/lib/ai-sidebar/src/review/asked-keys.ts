import type { Turn } from '../../../ai-providers/src/api'
import { shortcuts } from '../../../shortcuts/src/api'

export function latestAsked(turns: readonly Turn[]): string | null {
  for (let at = turns.length - 1; at >= 0; at--) {
    const parts = turns[at]?.parts ?? []
    for (let one = parts.length - 1; one >= 0; one--) {
      const part = parts[one]
      if (part?.kind === 'tool' && part.state === 'asking' && part.result?.approval) return part.result.approval
    }
  }
  return null
}
export function answerByKeys(
  event: KeyboardEvent,
  turns: readonly Turn[],
  answer: (approval: string, allow: boolean) => unknown,
): boolean {
  const allow = shortcuts.pressed('ai.approve', event) ? true : shortcuts.pressed('ai.deny', event) ? false : null
  if (allow === null) return false
  const approval = latestAsked(turns)
  if (approval === null) return false
  event.preventDefault()
  event.stopPropagation()
  void answer(approval, allow)
  return true
}
