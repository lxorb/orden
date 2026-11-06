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
} from './types'

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

const MARK = 'untrusted'

function inert(words: string): string {
  return words.replace(new RegExp(`<(?=/?${MARK})`, 'gi'), '&lt;')
}

function attribute(label: string): string {
  return label
    .slice(0, 300)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\r\n\t]/g, ' ')
}

export function untrusted(source: string, words: string): string {
  return `<${MARK} source="${attribute(source)}">\n${inert(words)}\n</${MARK}>`
}

const OPENED = `<${MARK} source="`

export function readOutside(turns: readonly Turn[]): boolean {
  return turns.some((turn) =>
    turn.role === 'you'
      ? turn.draft?.web === true ||
        (turn.draft?.attachments ?? []).some(
          (one) => one.untrusted === true || (one.text?.includes(OPENED) ?? false),
        )
      : turn.parts.some(
          (part) => part.kind === 'tool' && (part.result?.text.includes(OPENED) ?? false),
        ),
  )
}

function attached(one: Attachment): string {
  if (!one.text) return ''
  if (one.untrusted) return untrusted(one.label, one.text)
  return `<attached label="${attribute(one.label)}">\n${one.text}\n</attached>`
}

export function userStep(draft: Draft, context = ''): Extract<Step, { role: 'user' }> {
  const texts = draft.attachments.map(attached).filter(Boolean)
  const where = context ? [`<reader-context>\n${context}\n</reader-context>`] : []
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

export function sinceCompaction(
  turns: readonly Turn[],
  compaction: Compaction | undefined,
): Turn[] {
  if (!compaction) return [...turns]
  const at = turns.findIndex((one) => one.id === compaction.upTo)
  return at < 0 ? [...turns] : turns.slice(at + 1)
}

function compactionStep(compaction: Compaction, api: Api, model: string): Step | null {
  if (compaction.kind === api && compaction.model === model && compaction.block !== undefined) {
    return { role: 'compacted', block: compaction.block }
  }
  if (!compaction.summary) return null
  return {
    role: 'user',
    text: `<summary of="the conversation so far">\n${compaction.summary}\n</summary>`,
    images: [],
  }
}

export function stepsOf(
  thread: Pick<Thread, 'turns' | 'compaction'>,
  api: Api,
  model: string,
  perMessage = false,
): Step[] {
  const head = thread.compaction ? compactionStep(thread.compaction, api, model) : null
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
