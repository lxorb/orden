import { eventIn, type Heard, saysLimit, saysSignedOut } from './heard'

const OWN = /^mcp_(?:orden|nib)_/

const QUOTA = /quota|resource_exhausted|\b429\b/i

export function geminiReader(): (line: string) => Heard {
  let streamed = false

  return (line) => {
    const event = eventIn(line)
    if (!event) return {}

    switch (event.type) {
      case 'init':
        streamed = false
        return typeof event.model === 'string' && event.model ? { model: event.model } : {}

      case 'message': {
        if (event.role !== 'assistant' || typeof event.content !== 'string') return {}
        if (event.delta === true) streamed = true
        else if (streamed) return {}
        return event.content ? { text: event.content } : {}
      }

      case 'tool_use':
        if (typeof event.tool_id !== 'string' || typeof event.tool_name !== 'string') return {}
        return {
          tool: {
            id: event.tool_id,
            name: event.tool_name.replace(OWN, ''),
            args: event.parameters ?? {},
          },
        }

      case 'tool_result': {
        if (typeof event.tool_id !== 'string') return {}
        const failed = event.status === 'error'
        const output = typeof event.output === 'string' ? event.output : ''
        const words = failed ? messageOf(event.error) || output : output
        return { tool: { id: event.tool_id, name: '', done: { text: words, error: failed } } }
      }

      case 'error':
        return event.severity === 'error' && typeof event.message === 'string'
          ? trouble(event.message)
          : {}

      case 'result': {
        const usage = usageOf(record(event.stats))
        if (event.status !== 'error') return { ...usage, ended: 'end' }
        return { ...usage, ended: 'error', ...trouble(messageOf(event.error) || 'error') }
      }

      default:
        return {}
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function messageOf(error: unknown): string {
  const message = record(error)?.message
  return typeof message === 'string' ? message : ''
}

function trouble(words: string): Heard {
  const limited = saysLimit(words) || QUOTA.test(words)
  return {
    trouble: words,
    ...(saysSignedOut(words) ? { signedOut: true } : {}),
    ...(limited ? { limit: { state: 'reached', until: null, untilWords: null } } : {}),
  }
}

function usageOf(stats: Record<string, unknown> | null): Heard {
  if (!stats) return {}
  const number = (key: string) => (typeof stats[key] === 'number' ? stats[key] : 0)
  const input = number('input_tokens')
  if (!input && !number('output_tokens')) return {}
  return { usage: { input, cached: number('cached'), output: number('output_tokens') } }
}
