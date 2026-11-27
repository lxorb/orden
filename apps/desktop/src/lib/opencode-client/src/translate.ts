import type { Part, ToolOutput, Turn, Usage } from '../../ai-providers/src/api'
import type { AssistantInfo, Event, Info, Message, OcPart, PermissionRequest, Session } from './types'

const ORDEN = 'orden_'
export const verbOf = (tool: string): string => (tool.startsWith(ORDEN) ? tool.slice(ORDEN.length) : tool)
const text = (value: unknown): string => (typeof value === 'string' ? value : '')
export function asksOf(request: PermissionRequest): string {
  const first = request.patterns[0] ?? ''
  if (request.permission === 'bash') return `Run ${text(request.metadata.command) || request.patterns.join(' ')}`
  if (request.permission === 'edit') return `Edit ${text(request.metadata.filepath) || first}`
  if (request.permission === 'webfetch') return `Open ${text(request.metadata.url) || first}`
  if (request.permission === 'external_directory') return `Reach outside the space: ${first}`
  const verb = verbOf(request.permission).replace(/_/g, ' ')
  return request.patterns.length && first !== '*' ? `${verb} ${request.patterns.join(', ')}` : verb
}
function asking(request: PermissionRequest): ToolOutput {
  return { text: '', images: [], error: false, approval: request.id, asks: asksOf(request) }
}
export function partOf(part: OcPart, asked?: PermissionRequest): Part | null {
  if (part.type === 'text') return part.synthetic ? null : { kind: 'text', text: part.text }
  if (part.type === 'reasoning') {
    return { kind: 'thinking', text: part.text, ms: part.time.end ? part.time.end - part.time.start : 0 }
  }
  if (part.type !== 'tool') return null
  const base = { kind: 'tool' as const, id: part.callID, verb: verbOf(part.tool), args: part.state.input }
  if (asked) return { ...base, state: 'asking', result: asking(asked) }
  if (part.state.status === 'completed') {
    return { ...base, state: 'ok', result: { text: part.state.output, images: [], error: false } }
  }
  if (part.state.status === 'error') {
    return { ...base, state: 'error', result: { text: part.state.error, images: [], error: true } }
  }
  return { ...base, state: 'running' }
}
export function usageOf(info: AssistantInfo): Usage {
  return {
    input: info.tokens.input,
    cached: info.tokens.cache.read,
    output: info.tokens.output,
    reasoning: info.tokens.reasoning,
    window: null,
    cost: info.cost,
  }
}
function words(parts: readonly OcPart[]): string {
  return parts.flatMap((one) => (one.type === 'text' && !one.synthetic ? [one.text] : [])).join('\n')
}
export function turnOf(message: Message, asked: readonly PermissionRequest[] = []): Turn {
  const { info, parts } = message
  if (info.role === 'user') {
    return {
      id: info.id,
      role: 'you',
      at: info.time.created,
      draft: { text: words(parts), attachments: [] },
      parts: [],
    }
  }
  const byCall = new Map(asked.flatMap((one) => (one.tool ? [[one.tool.callID, one] as const] : [])))
  const shown = parts.flatMap((one) => {
    const part = partOf(one, one.type === 'tool' ? byCall.get(one.callID) : undefined)
    return part ? [part] : []
  })
  if (info.error)
    shown.push({ kind: 'notice', code: 'error', text: info.error.data?.message ?? info.error.name ?? 'Failed' })
  return {
    id: info.id,
    role: 'model',
    at: info.time.created,
    parts: shown,
    provider: info.providerID,
    model: info.modelID,
    usage: usageOf(info),
    ...(info.time.completed ? { took: info.time.completed - info.time.created } : {}),
  }
}
export class Feed {
  readonly sessions = new Map<string, Session>()
  private readonly messages = new Map<string, Map<string, Message>>()
  private readonly asked = new Map<string, PermissionRequest>()
  private readonly busy = new Set<string>()
  load(session: string, messages: readonly Message[], asked: readonly PermissionRequest[] = []): void {
    this.messages.set(session, new Map(messages.map((one) => [one.info.id, { info: one.info, parts: [...one.parts] }])))
    for (const one of asked) if (one.sessionID === session) this.asked.set(one.id, one)
  }
  private message(info: Pick<Info, 'id' | 'sessionID'> & Partial<Info>): Message | null {
    const held = this.messages.get(info.sessionID)
    if (!held) return null
    let one = held.get(info.id)
    if (!one && 'role' in info) {
      one = { info: info as Info, parts: [] }
      held.set(info.id, one)
    }
    return one ?? null
  }
  apply(event: Event): string | null {
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        this.sessions.set(event.properties.info.id, event.properties.info)
        return event.properties.info.id
      case 'session.deleted':
        this.sessions.delete(event.properties.info.id)
        this.messages.delete(event.properties.info.id)
        return event.properties.info.id
      case 'session.status':
        if (event.properties.status.type === 'idle') this.busy.delete(event.properties.sessionID)
        else this.busy.add(event.properties.sessionID)
        return event.properties.sessionID
      case 'session.idle':
        this.busy.delete(event.properties.sessionID)
        return event.properties.sessionID
      case 'session.error':
        return event.properties.sessionID ?? null
      case 'message.updated': {
        const one = this.message(event.properties.info)
        if (one) one.info = event.properties.info
        return one ? event.properties.info.sessionID : null
      }
      case 'message.part.updated': {
        const { part } = event.properties
        const one = this.message({ id: part.messageID, sessionID: part.sessionID })
        if (!one) return null
        const at = one.parts.findIndex((held) => held.id === part.id)
        if (at < 0) one.parts.push(part)
        else one.parts[at] = part
        return part.sessionID
      }
      case 'message.part.delta': {
        const { sessionID, messageID, partID, field, delta } = event.properties
        const part = this.message({ id: messageID, sessionID })?.parts.find((held) => held.id === partID)
        if (!part || (part.type !== 'text' && part.type !== 'reasoning') || field !== 'text') return null
        part.text += delta
        return sessionID
      }
      case 'permission.asked':
        this.asked.set(event.properties.id, event.properties)
        return event.properties.sessionID
      case 'permission.replied':
        this.asked.delete(event.properties.requestID)
        return event.properties.sessionID
    }
  }
  running(session: string): boolean {
    return this.busy.has(session)
  }
  waiting(session: string): PermissionRequest[] {
    return [...this.asked.values()].filter((one) => one.sessionID === session)
  }
  turns(session: string): Turn[] {
    const asked = this.waiting(session)
    return [...(this.messages.get(session)?.values() ?? [])].map((one) => turnOf(one, asked))
  }
}
