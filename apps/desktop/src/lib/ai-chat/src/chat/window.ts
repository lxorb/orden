import type { AutoCompact, ToolOutput } from '../../../ai-providers/src/api'
import { compactsAt, estimateText, PICTURE } from './usage'
import type { Step } from './transcript'

export const DEFAULT_WINDOW = 128_000
const BASE64 = /^[A-Za-z0-9+/=]+$/
export function windowOf(...known: (number | null | undefined)[]): number {
  return known.find((one): one is number => typeof one === 'number' && one > 0) ?? DEFAULT_WINDOW
}
export function limitOf(window: number, auto: AutoCompact = 'auto'): number {
  return Math.min(window, compactsAt(window, auto) ?? window)
}
export function tokensIn(body: unknown): number {
  let pictures = 0
  const text = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value !== 'string' || value.length < 4_000 || !BASE64.test(value)) return value
    pictures++
    return ''
  })
  return estimateText(text) + pictures * PICTURE
}
function cutText(text: string, most: number): string {
  let end = Math.min(text.length, most * 4)
  while (end > 0 && estimateText(text.slice(0, end)) > most) end = Math.floor(end * 0.9)
  return text.slice(0, end)
}
function cutOutput(output: ToolOutput, most: number): ToolOutput {
  const words = estimateText(output.text)
  const pictures = output.images.length * PICTURE
  if (words + pictures <= most) return output
  const images = output.images.slice(0, Math.max(0, Math.floor(most / 2 / PICTURE)))
  const room = Math.max(0, most - images.length * PICTURE - 80)
  const kept = words > room ? cutText(output.text, room) : output.text
  const left = output.images.length - images.length
  const said = [
    `[This answer was cut to fit the model’s window: it was about ${String(words + pictures)} tokens`,
    left ? `, ${String(left)} of its pictures left out` : '',
    '. Ask for a part of it, or a narrower answer.]',
  ].join('')
  return { ...output, text: `${kept}\n\n${said}`, images }
}
export function roomFor(window: number, limit: number, now: number): number {
  return Math.max(Math.floor(window / 16), Math.min(Math.floor(window / 4), limit - now))
}
export function fitOutputs<T extends { output: ToolOutput }>(results: readonly T[], room: number): T[] {
  const most = Math.floor(room / Math.max(1, results.length))
  return results.map((one) => ({ ...one, output: cutOutput(one.output, most) }))
}
function leftOut(count: number): Step {
  return {
    role: 'user',
    text: `(${String(count)} earlier messages are left out to fit the model’s window.)`,
    images: [],
  }
}
function cutTools(step: Step, window: number): Step {
  if (step.role !== 'tool') return step
  return { ...step, results: fitOutputs(step.results, Math.floor(window / 8)) }
}
export function fitSteps(
  steps: readonly Step[],
  size: (steps: Step[]) => number,
  most: number,
  window: number,
): Step[] {
  if (size([...steps]) <= most) return [...steps]
  const cut = steps.map((one) => cutTools(one, window))
  const head = cut[0]?.role === 'compacted' || isSummary(cut[0]) ? 1 : 0
  let kept = cut
  for (let dropped = 0; dropped <= cut.length - head; dropped++) {
    if (cut[head + dropped]?.role === 'tool') continue
    kept = [...cut.slice(0, head), ...(dropped ? [leftOut(dropped)] : []), ...cut.slice(head + dropped)]
    if (size(kept) <= most) return kept
  }
  return kept
}
function isSummary(step: Step | undefined): boolean {
  return step?.role === 'user' && step.text.startsWith('<summary of=')
}
