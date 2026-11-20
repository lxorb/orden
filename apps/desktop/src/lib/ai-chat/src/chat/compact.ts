import { compactUrl, type Provider, sseJson } from '../../../ai-providers/src/api'
import { ANTHROPIC_COMPACT_BETA } from './catalogue'
import { request } from './request'
import { round } from './round'
import { type Step, stepsOf } from './transcript'
import type { Api, Compaction, ModelInfo, Thread } from '../../../ai-providers/src/api'
import { compactionSpent, estimateText, noUsage } from './usage'
import { itemsOf } from './responses'
import { type Ask, record, text, type ToolDef, type Wire } from './wire'
import { fitSteps, tokensIn, windowOf } from './window'

const KEEP =
  'Summarize this conversation so it can be continued from the summary alone. Keep every note path, page address, decision, change made and still to make, and the reader’s latest open request, in their own words where they matter. Do not call tools; reply with the summary only.'
function summaryPrompt(focus?: string): string {
  return focus?.trim() ? `${KEEP}\nFocus on: ${focus.trim()}` : KEEP
}
interface Compacting {
  thread: Thread
  provider: Provider
  api: Api
  wire: Wire
  model: ModelInfo
  system: string
  tools: ToolDef[]
  focus?: string | undefined
  steps?: Step[]
}
export async function compactThread(job: Compacting, signal?: AbortSignal): Promise<void> {
  const { thread } = job
  const last = thread.turns.at(-1)
  if (!last) return
  const { spent, ...made } = await compactionOf(job, signal)
  thread.compaction = { ...made, upTo: last.id }
  if (spent) {
    const before = thread.spent ?? { input: 0, output: 0 }
    thread.spent = {
      ...before,
      input: before.input + spent.input,
      output: before.output + spent.output,
    }
  }
  thread.usage = { ...noUsage(job.model.window), input: estimateText(made.summary) }
  thread.turns.push({
    id: crypto.randomUUID(),
    role: 'model',
    at: Date.now(),
    parts: [{ kind: 'notice', code: 'compacted', text: '' }],
  })
  thread.updated = Date.now()
}
export type Made = Omit<Compaction, 'upTo'> & { spent?: { input: number; output: number } }
function askOf(job: Compacting, steps: Step[]): Ask {
  return {
    provider: job.provider,
    model: job.model,
    effort: 'auto',
    fast: false,
    system: job.system,
    tools: job.tools,
    steps,
    added: [],
    web: false,
    perMessage: false,
  }
}
function stepsFor(job: Compacting, api: Api, after: Step[] = []): Step[] {
  const window = windowOf(job.thread.usage.window, job.model.window)
  const most = window - Math.min(8_192, Math.round(window / 8))
  const size = (steps: Step[]) => tokensIn(job.wire.request(askOf(job, [...steps, ...after])).body)
  return [...fitSteps(job.steps ?? stepsOf(job.thread, api, job.model.id), size, most, window), ...after]
}
export async function compactionOf(job: Compacting, signal?: AbortSignal): Promise<Made> {
  if (job.api === 'anthropic' && job.model.compaction) {
    const own = await anthropicCompaction(job, signal).catch(() => null)
    if (own) return own
  }
  if (job.provider.kind === 'openai') {
    const own = await responsesCompaction(job, signal).catch(() => null)
    if (own) return own
  }
  return await ownSummary(job, signal)
}
async function anthropicCompaction(job: Compacting, signal?: AbortSignal): Promise<Made | null> {
  const { url, body, headers } = job.wire.request(askOf(job, stepsFor(job, 'anthropic')))
  const asked = {
    ...record(body),
    stream: false,
    max_tokens: 8_192,
    compaction: {
      type: 'summarize',
      ...(job.focus?.trim() ? { instructions: summaryPrompt(job.focus) } : {}),
    },
  }
  const betas = [headers['anthropic-beta'], ANTHROPIC_COMPACT_BETA].filter(Boolean).join(',')
  const response = await request(
    job.provider,
    url,
    { body: JSON.stringify(asked), headers: { ...headers, 'anthropic-beta': betas } },
    signal,
  )
  const answer = record(sseJson(await response.text()))
  if (answer.stop_reason !== 'compaction') return null
  const content = Array.isArray(answer.content) ? answer.content.map(record) : []
  const block = content.find((one) => one.type === 'compaction')
  if (!block) return null
  return {
    kind: 'anthropic',
    model: job.model.id,
    summary: text(block.content),
    block,
    spent: compactionSpent(answer.usage),
  }
}
async function responsesCompaction(job: Compacting, signal?: AbortSignal): Promise<Omit<Compaction, 'upTo'> | null> {
  const input = itemsOf(stepsFor(job, 'responses'))
  const response = await request(
    job.provider,
    compactUrl(job.provider),
    {
      body: JSON.stringify({
        model: job.model.id,
        input,
        ...(job.system ? { instructions: job.system } : {}),
      }),
    },
    signal,
  )
  const output = record(sseJson(await response.text())).output
  if (!Array.isArray(output) || !output.length) return null
  return { kind: 'responses', model: job.model.id, summary: '', block: output }
}
async function ownSummary(job: Compacting, signal?: AbortSignal): Promise<Omit<Compaction, 'upTo'>> {
  const steps = stepsFor(job, job.api, [{ role: 'user', text: summaryPrompt(job.focus), images: [] }])
  const result = await round(
    job.wire,
    askOf(job, steps),
    () => undefined,
    () => undefined,
    signal ?? new AbortController().signal,
  )
  const summary = result.parts.flatMap((one) => (one.kind === 'text' ? [one.text] : [])).join('')
  if (!summary.trim()) throw new Error('No answer')
  return { kind: 'summary', model: job.model.id, summary }
}
