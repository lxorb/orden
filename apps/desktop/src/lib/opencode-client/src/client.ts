import { invoke } from '../../platform/src/api'
import { Channel } from '../../crate/src/api'
import type { Agent, Event, Message, PermissionRequest, Providers, Reply, Session } from './types'

export type Preset = 'approve' | 'auto' | 'full'
export interface Status {
  state: string
  port: number | null
}
interface Answer {
  status: number
  body: unknown
}
export type Call = (method: string, path: string, body?: unknown) => Promise<Answer>
const viaApp: Call = (method, path, body) =>
  invoke<Answer>('opencode_call', { method, path, ...(body === undefined ? {} : { body }) })
function said(body: unknown): string {
  if (typeof body === 'string') return body
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const data = typeof fields.data === 'object' && fields.data !== null ? (fields.data as Record<string, unknown>) : {}
  const message = data.message ?? fields.message ?? fields.error
  return typeof message === 'string' ? message : JSON.stringify(body)
}
export class OpenCode {
  constructor(private readonly call: Call = viaApp) {}
  private async asked<T>(method: string, path: string, body?: unknown): Promise<T> {
    const answer = await this.call(method, path, body)
    if (answer.status >= 400) throw new Error(`OpenCode ${String(answer.status)}: ${said(answer.body)}`)
    return answer.body as T
  }
  sessions(): Promise<Session[]> {
    return this.asked('GET', '/session')
  }
  session(title?: string): Promise<Session> {
    return this.asked('POST', '/session', title ? { title } : {})
  }
  rename(id: string, title: string): Promise<Session> {
    return this.asked('PATCH', `/session/${id}`, { title })
  }
  remove(id: string): Promise<boolean> {
    return this.asked('DELETE', `/session/${id}`)
  }
  messages(id: string): Promise<Message[]> {
    return this.asked('GET', `/session/${id}/message`)
  }
  prompt(id: string, text: string, how: { agent?: string; providerID?: string; modelID?: string } = {}): Promise<void> {
    const model = how.providerID && how.modelID ? { model: { providerID: how.providerID, modelID: how.modelID } } : {}
    return this.asked('POST', `/session/${id}/prompt_async`, {
      parts: [{ type: 'text', text }],
      ...(how.agent ? { agent: how.agent } : {}),
      ...model,
    })
  }
  abort(id: string): Promise<boolean> {
    return this.asked('POST', `/session/${id}/abort`)
  }
  permissions(): Promise<PermissionRequest[]> {
    return this.asked('GET', '/permission')
  }
  reply(id: string, reply: Reply, message?: string): Promise<boolean> {
    return this.asked('POST', `/permission/${id}/reply`, { reply, ...(message ? { message } : {}) })
  }
  agents(): Promise<Agent[]> {
    return this.asked('GET', '/agent')
  }
  providers(): Promise<Providers> {
    return this.asked('GET', '/provider')
  }
}
export const opencode = new OpenCode()
export function startOpenCode(config: unknown, preset: Preset): Promise<Status> {
  return invoke<Status>('opencode_start', { config, preset })
}
export function restartOpenCode(config: unknown, preset: Preset): Promise<Status> {
  return invoke<Status>('opencode_restart', { config, preset })
}
export function openCodeStatus(): Promise<Status> {
  return invoke<Status>('opencode_status')
}
export function stopOpenCode(): Promise<Status> {
  return invoke<Status>('opencode_stop')
}
export function isEvent(value: unknown): value is Event {
  if (typeof value !== 'object' || value === null) return false
  const fields = value as Record<string, unknown>
  return typeof fields.type === 'string' && typeof fields.properties === 'object' && fields.properties !== null
}
export async function followEvents(on: (event: Event) => void): Promise<() => Promise<void>> {
  const events = new Channel<unknown>()
  events.onmessage = (value) => {
    if (isEvent(value)) on(value)
  }
  await invoke('opencode_events_start', { events })
  return () => invoke('opencode_events_stop').then(() => undefined)
}
