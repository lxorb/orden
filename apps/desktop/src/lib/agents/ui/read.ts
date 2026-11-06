import type { AgentEvent, Approval } from '../verbs'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const out: string[] = []
  for (const one of value as unknown[]) {
    if (typeof one !== 'string') return null
    out.push(one)
  }
  return out
}

function readApproval(value: unknown): Approval | null {
  if (!isRecord(value)) return null

  const { id, agent, name, category, summary, asked, answer } = value
  return typeof id === 'string' &&
    typeof agent === 'string' &&
    typeof name === 'string' &&
    typeof category === 'string' &&
    typeof summary === 'string' &&
    typeof asked === 'number' &&
    typeof answer === 'string'
    ? (value as unknown as Approval)
    : null
}

export function readEvent(value: unknown): AgentEvent | null {
  if (!isRecord(value)) return null

  const text = (key: string): string | null => {
    const one = value[key]
    return typeof one === 'string' ? one : null
  }
  const agent = text('agent')
  const tab = text('tab')

  switch (value.kind) {
    case 'acting': {
      const verb = text('verb')
      return agent !== null && tab !== null && verb !== null
        ? { kind: 'acting', agent, tab, verb }
        : null
    }
    case 'paused':
    case 'resumed':
      return agent === null ? null : { kind: value.kind, agent }
    case 'asked':
    case 'answered': {
      const approval = readApproval(value.approval)
      return approval ? { kind: value.kind, approval } : null
    }
    case 'tab': {
      const id = text('id')
      const url = text('url')
      const title = text('title')
      return agent !== null && id !== null && url !== null && title !== null
        ? { kind: 'tab', agent, id, url, title }
        : null
    }
    case 'closed': {
      const id = text('id')
      return agent !== null && id !== null ? { kind: 'closed', agent, id } : null
    }
    case 'stopped':
      return typeof value.closed === 'boolean' ? { kind: 'stopped', closed: value.closed } : null
    case 'connected': {
      const agents = strings(value.agents)
      return agents ? { kind: 'connected', agents } : null
    }
    default:
      return null
  }
}
