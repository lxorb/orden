import type { Thread } from '../../ai-providers/src/api'
import { fatal } from './goal'
import type { Ended } from './types'

const MINUTE = 60_000
export const SHORTEST = MINUTE
const LONGEST = 24 * 60 * MINUTE
export const PACED = 10 * MINUTE

const UNITS: Record<string, number> = { s: 1_000, m: MINUTE, h: 60 * MINUTE, d: 24 * 60 * MINUTE }

export function intervalIn(word: string): number | null {
  const found =
    /^(\d+(?:\.\d+)?)\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)$/i.exec(
      word.trim(),
    )
  if (!found) return null
  const unit = UNITS[(found[2] ?? 'm').charAt(0).toLowerCase()] ?? MINUTE
  return Math.min(LONGEST, Math.max(SHORTEST, Number(found[1]) * unit))
}

export interface LoopAsk {
  every: number | null
  prompt: string
}

export function loopAsk(args: string): LoopAsk {
  const said = args.trim()
  const [first = '', ...rest] = said.split(/\s+/)
  const every = intervalIn(first)
  return every === null ? { every: null, prompt: said } : { every, prompt: rest.join(' ') }
}

export const CARRY_ON =
  'Look at what this thread has been doing and carry on with whatever is unfinished. If nothing is left to do, say so in one line.'

export const PACING =
  'End your answer with a last line `next: <minutes>m` saying when this should run again, or `next: done` when nothing is left to do.'

export function nextIn(answer: string): number | 'done' | null {
  const lines = [...answer.matchAll(/^\s*`?next:\s*([^`\n]+)`?\s*$/gim)]
  const said = lines.at(-1)?.[1]?.trim().toLowerCase()
  if (!said) return null
  if (said === 'done' || said === 'stop') return 'done'
  return intervalIn(said)
}

export function answerOf(ended: Ended): string {
  return (
    ended.turn?.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('') ?? ''
  )
}

export function loopPrompt(asked: LoopAsk, thread: Pick<Thread, 'turns'> | null): string {
  if (asked.prompt) return asked.prompt
  const said = (thread?.turns ?? []).filter((turn) => turn.role === 'you' && turn.draft?.text)
  return said.at(-1)?.draft?.text ?? CARRY_ON
}

export interface LoopRoad {
  turn(text: string, signal: AbortSignal): Promise<Ended>
  wait(ms: number, signal: AbortSignal): Promise<void>
  ended(why: string): void
}

export async function runLoop(
  asked: LoopAsk,
  prompt: string,
  road: LoopRoad,
  signal: AbortSignal,
): Promise<void> {
  const text = asked.every === null ? `${prompt}\n\n${PACING}` : prompt
  const stopped = () => signal.aborted
  for (;;) {
    if (stopped()) return
    const ended = await road.turn(text, signal)
    if (stopped() || ended.stop === 'stopped') return
    if (ended.stop === 'error' && fatal(ended)) {
      road.ended(ended.error ?? '')
      return
    }
    let wait = asked.every
    if (wait === null) {
      const next = nextIn(answerOf(ended))
      if (next === 'done') {
        road.ended('')
        return
      }
      wait = next ?? PACED
    }
    await road.wait(wait, signal)
  }
}
