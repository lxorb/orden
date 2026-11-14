import {
  type Counted,
  eventIn,
  type Heard,
  type Limit,
  saysLimit,
  saysSignedOut,
  type ToolHeard,
} from './heard'

const OWN = /^mcp__(?:orden|nib)__/

export function claudeReader(): (line: string) => Heard {
  let streamed = false
  let counted: Counted = {}

  return (line) => {
    const event = eventIn(line)
    if (!event || event.parent_tool_use_id) return {}

    switch (event.type) {
      case 'system':
        if (event.subtype === 'compact_boundary') return { compacted: true }
        return event.subtype === 'init' ? named(event.model) : {}

      case 'stream_event':
        return streamEvent(record(event.event))

      case 'assistant': {
        const content = record(event.message)?.content
        const tool = toolUse(content)
        if (tool) return { tool }
        if (streamed) return {}
        const text = textOf(content)
        return text ? { text } : {}
      }

      case 'user': {
        const tool = toolResult(record(event.message)?.content)
        return tool ? { tool } : {}
      }

      case 'rate_limit_event': {
        const limit = limitIn(record(event.rate_limit_info))
        return limit ? { limit } : {}
      }

      case 'result':
        return result(event)

      default:
        return {}
    }
  }

  function streamEvent(inner: Record<string, unknown> | null): Heard {
    if (inner?.type === 'message_start') {
      streamed = false
      const message = record(inner.message)
      counted = { ...countsIn(record(message?.usage)) }
      return { ...named(message?.model), ...(counted.input ? { usage: { ...counted } } : {}) }
    }
    if (inner?.type === 'message_delta') {
      const output = record(inner.usage)?.output_tokens
      if (typeof output !== 'number') return {}
      counted = { ...counted, output }
      return { usage: { ...counted } }
    }
    const delta = record(inner?.delta)
    if (inner?.type !== 'content_block_delta' || !delta) return {}
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking)
      return { thinking: delta.thinking }
    if (delta.type !== 'text_delta' || typeof delta.text !== 'string' || !delta.text) return {}
    streamed = true
    return { text: delta.text }
  }

  function result(event: Record<string, unknown>): Heard {
    const window = windowIn(record(event.modelUsage))
    const usage: Heard = window ? { usage: { ...counted, window } } : {}
    if (event.is_error !== true) return { ...usage, ended: 'end' }
    const words =
      typeof event.result === 'string' && event.result
        ? event.result
        : typeof event.subtype === 'string'
          ? event.subtype
          : 'error'
    return {
      ...usage,
      ended: 'error',
      trouble: words,
      ...(saysSignedOut(words) ? { signedOut: true } : {}),
      ...(saysLimit(words) ? { limit: { state: 'reached', until: null, untilWords: null } } : {}),
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function named(model: unknown): Heard {
  if (typeof model !== 'string' || !model) return {}
  return { model: model.replace(/\[[^\]]*\]$/, '') }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      const one = record(block)
      return one?.type === 'text' && typeof one.text === 'string' ? one.text : ''
    })
    .join('')
}

function toolUse(content: unknown): ToolHeard | null {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    const one = record(block)
    if (one?.type !== 'tool_use' || typeof one.id !== 'string' || typeof one.name !== 'string')
      continue
    return { id: one.id, name: one.name.replace(OWN, ''), args: one.input ?? {} }
  }
  return null
}

function toolResult(content: unknown): ToolHeard | null {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    const one = record(block)
    if (one?.type !== 'tool_result' || typeof one.tool_use_id !== 'string') continue
    const text =
      typeof one.content === 'string'
        ? one.content
        : Array.isArray(one.content)
          ? textOf(one.content)
          : ''
    return { id: one.tool_use_id, name: '', done: { text, error: one.is_error === true } }
  }
  return null
}

function countsIn(usage: Record<string, unknown> | null): Counted {
  if (!usage) return {}
  const number = (key: string) => (typeof usage[key] === 'number' ? usage[key] : 0)
  const cached = number('cache_read_input_tokens')
  const input = number('input_tokens') + cached + number('cache_creation_input_tokens')
  return { input, cached, output: number('output_tokens') }
}

function windowIn(usage: Record<string, unknown> | null): number | null {
  if (!usage) return null
  for (const one of Object.values(usage)) {
    const window = record(one)?.contextWindow
    if (typeof window === 'number' && window > 0) return window
  }
  return null
}

function limitIn(info: Record<string, unknown> | null): Limit | null {
  if (!info) return null
  const state =
    info.status === 'rejected' ? 'reached' : info.status === 'allowed_warning' ? 'near' : 'fine'
  const until = typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : null
  return { state, until, untilWords: null }
}
