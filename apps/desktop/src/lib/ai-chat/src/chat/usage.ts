import type { AutoCompact, Draft, Usage } from '../../../ai-providers/src/api'

export function noUsage(window: number | null): Usage {
  return { input: 0, cached: 0, output: 0, reasoning: 0, window }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export function anthropicUsage(said: unknown, window: number | null): Usage {
  const usage = record(said)
  const read = count(usage.cache_read_input_tokens)
  const input = count(usage.input_tokens) + read + count(usage.cache_creation_input_tokens)
  return { input, cached: read, output: count(usage.output_tokens), reasoning: 0, window }
}

export function compactionSpent(said: unknown): { input: number; output: number } {
  const iterations = record(said).iterations
  if (!Array.isArray(iterations)) return { input: 0, output: 0 }
  const spent = { input: 0, output: 0 }
  for (const one of iterations.map(record)) {
    if (one.type !== 'compaction') continue
    spent.input += count(one.input_tokens)
    spent.output += count(one.output_tokens)
  }
  return spent
}

export function responsesUsage(said: unknown, window: number | null): Usage {
  const usage = record(said)
  return {
    input: count(usage.input_tokens),
    cached: count(record(usage.input_tokens_details).cached_tokens),
    output: count(usage.output_tokens),
    reasoning: count(record(usage.output_tokens_details).reasoning_tokens),
    window,
  }
}

export function geminiUsage(said: unknown, window: number | null): Usage {
  const usage = record(said)
  const thoughts = count(usage.thoughtsTokenCount)
  return {
    input: count(usage.promptTokenCount) + count(usage.toolUsePromptTokenCount),
    cached: count(usage.cachedContentTokenCount),
    output: count(usage.candidatesTokenCount) + thoughts,
    reasoning: thoughts,
    window,
  }
}

export function completionsUsage(said: unknown, window: number | null): Usage {
  const usage = record(said)
  const cost = usage.cost
  return {
    input: count(usage.prompt_tokens),
    cached: count(record(usage.prompt_tokens_details).cached_tokens),
    output: count(usage.completion_tokens),
    reasoning: count(record(usage.completion_tokens_details).reasoning_tokens),
    window,
    ...(typeof cost === 'number' && Number.isFinite(cost) ? { cost } : {}),
  }
}

export function added(before: Usage, after: Usage): Usage {
  const cost = (before.cost ?? 0) + (after.cost ?? 0)
  return {
    input: after.input,
    cached: after.cached,
    output: after.output,
    reasoning: before.reasoning + after.reasoning,
    window: after.window ?? before.window,
    ...(before.cost !== undefined || after.cost !== undefined ? { cost } : {}),
  }
}

export function filled(usage: Usage): number {
  return usage.input + usage.output
}

const PICTURE = 1_600

export function estimateText(words: string): number {
  let wide = 0
  for (let at = 0; at < words.length; at++) {
    const one = words.charCodeAt(at)
    if (one > 0x2fff && (one < 0xdc00 || one > 0xdfff)) wide++
  }
  return Math.ceil((words.length - wide) / 4 + wide)
}

export function estimate(draft: Draft): number {
  let tokens = estimateText(draft.text)
  for (const one of draft.attachments) {
    if (one.text) tokens += estimateText(one.text) + estimateText(one.label) + 8
    if (one.image) tokens += PICTURE
  }
  return tokens
}

export function compactsAt(window: number | null, auto: AutoCompact = 'auto'): number | null {
  if (auto === 'off') return null
  if (typeof auto === 'number') return window ? Math.min(auto, window) : auto
  if (!window) return null
  return window - Math.min(33_000, Math.round(window * 0.2))
}

export function fraction(usage: Usage, draft = 0): number | null {
  if (!usage.window) return null
  return Math.min(1, (filled(usage) + draft) / usage.window)
}

export function warns(usage: Usage, draft = 0): boolean {
  return (fraction(usage, draft) ?? 0) >= 0.8
}

export function shouldCompact(usage: Usage, draft: number, auto: AutoCompact = 'auto'): boolean {
  const at = compactsAt(usage.window, auto)
  return at !== null && filled(usage) > 0 && filled(usage) + draft >= at
}
