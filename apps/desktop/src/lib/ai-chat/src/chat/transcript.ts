import { defused, untrusted } from '@orden/chats/agent'
import type {
  Api,
  Attachment,
  Compaction,
  Draft,
  Effort,
  Part,
  Thread,
  ToolOutput,
  Turn,
} from '../../../ai-providers/src/api'
import { movedSince } from '../../../ai-providers/src/api'

export type Step =
  | { role: 'user'; text: string; images: { mime: string; data: string }[] }
  | { role: 'assistant'; text: string; calls: Call[] }
  | { role: 'tool'; results: { id: string; name: string; output: ToolOutput }[] }
  | { role: 'native'; messages: unknown[] }
  | { role: 'compacted'; block: unknown }
  | { role: 'effort'; effort: Effort }
export interface Call {
  id: string
  name: string
  args: unknown
}
export function modelTurn({ provider, model, effort }: Thread): Turn {
  return {
    id: crypto.randomUUID(),
    role: 'model',
    at: Date.now(),
    parts: [],
    provider,
    model,
    effort,
  }
}
export function answeredBy(thread: Pick<Thread, 'turns'>): { provider: string; model: string } | null {
  for (let at = thread.turns.length - 1; at >= 0; at--) {
    const turn = thread.turns[at]
    if (turn?.role === 'model' && turn.model)
      return { provider: movedSince(turn.provider ?? '', turn.at), model: turn.model }
  }
  return null
}
export function continuedWith(thread: Pick<Thread, 'turns' | 'provider'>, name: string): Part | null {
  const last = answeredBy(thread)
  if (!last?.provider || last.provider === thread.provider) return null
  return { kind: 'notice', code: 'model', text: `Continued with ${name}: it reads the whole chat again` }
}
export function youTurn(thread: Thread, draft: Draft, more: Partial<Turn> = {}): Turn {
  const { effort } = thread
  return { id: crypto.randomUUID(), role: 'you', at: Date.now(), draft, parts: [], effort, ...more }
}
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
const MARK = 'untrusted'
function attribute(label: string): string {
  return label
    .slice(0, 300)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
}
export { untrusted }
const OPENED = `<${MARK} source="`
export const SUMMED_OUTSIDE = 'outside'
export function readOutside(turns: readonly Turn[]): boolean {
  return (
    turns.some((turn) =>
      turn.role === 'you'
        ? turn.draft?.web === true ||
          (turn.draft?.attachments ?? []).some((one) => one.untrusted === true || (one.text?.includes(OPENED) ?? false))
        : turn.parts.some(
            (part) =>
              (part.kind === 'notice' && part.code === 'compacted' && part.text === SUMMED_OUTSIDE) ||
              (part.kind === 'tool' &&
                (part.verb.startsWith('browser_') ||
                  !!part.result?.images.length ||
                  (part.result?.text.includes(OPENED) ?? false))),
          ),
    ) || turns.some((turn) => turn.context?.includes(OPENED) ?? false)
  )
}
function attached(one: Attachment): string {
  if (!one.text) return ''
  if (one.untrusted) return untrusted(one.label, one.text)
  return `<attached label="${attribute(one.label)}">\n${defused(one.text)}\n</attached>`
}
export function userStep(draft: Draft, context = ''): Extract<Step, { role: 'user' }> {
  const texts = draft.attachments.map(attached).filter(Boolean)
  const where = context ? [`<reader-context>\n${defused(context)}\n</reader-context>`] : []
  return {
    role: 'user',
    text: [...where, ...texts, draft.text].join('\n\n'),
    images: draft.attachments.flatMap((one) => (one.image ? [one.image] : [])),
  }
}
const UNANSWERED: ToolOutput = {
  text: 'The call was stopped before it answered.',
  images: [],
  error: true,
}
export function partsAsSteps(parts: readonly Part[]): Step[] {
  const steps: Step[] = []
  let words = ''
  let calls: Extract<Part, { kind: 'tool' }>[] = []
  const flush = () => {
    if (!words && !calls.length) return
    steps.push({
      role: 'assistant',
      text: words,
      calls: calls.map((one) => ({ id: one.id, name: one.verb, args: one.args })),
    })
    if (calls.length) {
      steps.push({
        role: 'tool',
        results: calls.map((one) => ({
          id: one.id,
          name: one.verb,
          output: one.result ?? UNANSWERED,
        })),
      })
    }
    words = ''
    calls = []
  }
  for (const part of parts) {
    if (part.kind === 'text') {
      if (calls.length) flush()
      words += part.text
    } else if (part.kind === 'tool') {
      calls.push(part)
    }
  }
  flush()
  return steps
}
function replays(turn: Turn, api: Api, model: string): boolean {
  return !!turn.replay && turn.replay.api === api && turn.replay.model === model
}
export function sinceCompaction(turns: readonly Turn[], compaction: Compaction | undefined): Turn[] {
  if (!compaction) return [...turns]
  const at = turns.findIndex((one) => one.id === compaction.upTo)
  return at < 0 ? [...turns] : turns.slice(at + 1)
}
function compactionStep(compaction: Compaction, api: Api, model: string, outside: boolean): Step | null {
  if (compaction.kind === api && compaction.model === model && compaction.block !== undefined) {
    return { role: 'compacted', block: compaction.block }
  }
  const text = summaryOf(compaction, outside)
  return text === null ? null : { role: 'user', text, images: [] }
}
export function summaryOf(compaction: Compaction, outside: boolean): string | null {
  if (!compaction.summary) return null
  const said = outside
    ? untrusted('a summary of a conversation that read others’ words', compaction.summary)
    : defused(compaction.summary)
  return `<summary of="the conversation so far">\n${said}\n</summary>`
}
export function stepsOf(
  thread: Pick<Thread, 'turns' | 'compaction'>,
  api: Api,
  model: string,
  perMessage = false,
): Step[] {
  const head = thread.compaction ? compactionStep(thread.compaction, api, model, readOutside(thread.turns)) : null
  const turns = head ? sinceCompaction(thread.turns, thread.compaction) : thread.turns
  const steps: Step[] = head ? [head] : []
  let effort: Effort | undefined
  for (const turn of turns) {
    if (turn.role === 'you') {
      if (perMessage && turn.effort && effort && turn.effort !== effort) {
        steps.push({ role: 'effort', effort: turn.effort })
      }
      effort = turn.effort ?? effort
      if (turn.draft) steps.push(userStep(turn.draft, turn.context))
    } else if (replays(turn, api, model) && turn.replay) {
      steps.push({ role: 'native', messages: turn.replay.messages })
    } else {
      steps.push(...partsAsSteps(turn.parts))
    }
  }
  return steps
}
export function baseEffort(thread: Pick<Thread, 'turns' | 'compaction'>, current: Effort): Effort {
  const turns = sinceCompaction(thread.turns, thread.compaction)
  return turns.find((one) => one.role === 'you' && one.effort)?.effort ?? current
}
export function outputText(output: ToolOutput): string {
  const pictures = output.images.length ? `\n[${output.images.length} picture(s)]` : ''
  return output.text + pictures
}
