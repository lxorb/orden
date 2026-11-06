import type { GoalState } from '../chat/types'
import { type Counted, eventIn, type Heard, type Limit, saysLimit, saysSignedOut } from './heard'

const NEAR = 80

export function codexReader(): (line: string) => Heard {
  const said = new Map<string, number>()

  function more(id: string, text: string, whole: boolean): Heard {
    const before = said.get(id) ?? 0
    const gap = before === 0 && said.size > 0 && !said.has(id) ? '\n\n' : ''
    const next = whole ? text.slice(before) : text
    said.set(id, whole ? text.length : before + text.length)
    return next ? { text: gap + next } : {}
  }

  return (line) => {
    const event = eventIn(line)
    const params = record(event?.params)
    if (!event || !params) return {}

    switch (event.method) {
      case 'item/agentMessage/delta':
        return typeof params.delta === 'string'
          ? more(text(params.itemId), params.delta, false)
          : {}

      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        return typeof params.delta === 'string' && params.delta ? { thinking: params.delta } : {}

      case 'item/started':
      case 'item/completed': {
        const item = record(params.item)
        const done = event.method === 'item/completed'
        if (item?.type === 'agentMessage' && done && typeof item.text === 'string')
          return more(text(item.id), item.text, true)
        if (item?.type === 'mcpToolCall') return toolIn(item, done)
        if (item?.type === 'contextCompaction' && done) return { compacted: true }
        return {}
      }

      case 'thread/compacted':
        return { compacted: true }

      case 'thread/goal/updated': {
        const goal = goalIn(record(params.goal)?.status)
        return goal ? { goal } : {}
      }

      case 'thread/goal/cleared':
        return { goal: 'cleared' }

      case 'thread/tokenUsage/updated': {
        const usage = record(params.tokenUsage)
        return { usage: countsIn(record(usage?.last), usage?.modelContextWindow) }
      }

      case 'account/rateLimits/updated': {
        const limit = limitIn(record(params.rateLimits))
        return limit ? { limit } : {}
      }

      case 'error':
        return params.willRetry === true ? {} : trouble(record(params.error))

      case 'turn/completed': {
        const turn = record(params.turn)
        if (turn?.status === 'completed') return { ended: 'end' }
        if (turn?.status === 'interrupted') return { ended: 'stopped' }
        return { ended: 'error', ...trouble(record(turn?.error)) }
      }

      default:
        return {}
    }
  }
}

function goalIn(status: unknown): GoalState | null {
  switch (status) {
    case 'active':
      return 'pursuing'
    case 'complete':
      return 'met'
    case 'budgetLimited':
      return 'budget_limited'
    case 'paused':
    case 'blocked':
    case 'usageLimited':
      return 'paused'
    default:
      return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const OWN = new Set<unknown>(['orden', 'nib'])

function toolIn(item: Record<string, unknown>, done: boolean): Heard {
  if (!OWN.has(item.server) || typeof item.id !== 'string' || typeof item.tool !== 'string')
    return {}
  const tool = { id: item.id, name: item.tool, args: item.arguments ?? {} }
  if (!done) return { tool }
  const result = record(item.result)
  const failed = record(item.error)
  const words = Array.isArray(result?.content)
    ? result.content
        .map((one) => record(one))
        .map((one) => (one?.type === 'text' ? text(one.text) : ''))
        .join('\n')
    : text(failed?.message)
  return {
    tool: { ...tool, done: { text: words, error: item.status === 'failed' || !!failed } },
  }
}

function countsIn(last: Record<string, unknown> | null, window: unknown): Counted {
  const number = (key: string) => (typeof last?.[key] === 'number' ? last[key] : 0)
  return {
    input: number('inputTokens'),
    cached: number('cachedInputTokens'),
    output: number('outputTokens'),
    reasoning: number('reasoningOutputTokens'),
    ...(typeof window === 'number' && window > 0 ? { window } : {}),
  }
}

function limitIn(limits: Record<string, unknown> | null): Limit | null {
  if (!limits) return null
  const windows = [record(limits.primary), record(limits.secondary)].filter(
    (one): one is Record<string, unknown> => typeof one?.usedPercent === 'number',
  )
  const fullest = windows.sort((a, b) => Number(b.usedPercent) - Number(a.usedPercent))[0]
  if (!fullest && !limits.rateLimitReachedType) return null
  const used = Number(fullest?.usedPercent ?? 100)
  const state =
    limits.rateLimitReachedType || used >= 100 ? 'reached' : used >= NEAR ? 'near' : 'fine'
  const until = typeof fullest?.resetsAt === 'number' ? fullest.resetsAt * 1000 : null
  return { state, until, untilWords: null }
}

function trouble(error: Record<string, unknown> | null): Heard {
  const words = text(error?.message)
  if (!words) return {}
  const limited = error?.codexErrorInfo === 'usageLimitExceeded' || saysLimit(words)
  return {
    trouble: words,
    ...(saysSignedOut(words) || error?.codexErrorInfo === 'unauthorized'
      ? { signedOut: true }
      : {}),
    ...(limited ? { limit: { state: 'reached', until: null, untilWords: againAt(words) } } : {}),
  }
}

export function againAt(words: string): string | null {
  const found = /try again (?:at|in) ([^.]+?)\.?$/i.exec(words.trim())
  return found?.[1]?.trim() ?? null
}
