export interface Session {
  id: string
  title: string
  parentID?: string
  time: { created: number; updated: number; archived?: number }
}
interface Tokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}
interface UserInfo {
  id: string
  sessionID: string
  role: 'user'
  time: { created: number }
  agent: string
  model: { providerID: string; modelID: string }
}
export interface AssistantInfo {
  id: string
  sessionID: string
  role: 'assistant'
  time: { created: number; completed?: number }
  agent: string
  providerID: string
  modelID: string
  cost: number
  tokens: Tokens
  error?: { name?: string; data?: { message?: string } }
}
export type Info = UserInfo | AssistantInfo
interface PartBase {
  id: string
  sessionID: string
  messageID: string
}
type ToolStatus =
  | { status: 'pending'; input: unknown }
  | { status: 'running'; input: unknown; title?: string }
  | { status: 'completed'; input: unknown; output: string; title: string; metadata: Record<string, unknown> }
  | { status: 'error'; input: unknown; error: string }
export type OcPart =
  | (PartBase & { type: 'text'; text: string; synthetic?: boolean })
  | (PartBase & { type: 'reasoning'; text: string; time: { start: number; end?: number } })
  | (PartBase & { type: 'tool'; callID: string; tool: string; state: ToolStatus })
  | (PartBase & { type: 'step-finish'; cost: number; tokens: Tokens })
  | (PartBase & { type: 'step-start' | 'snapshot' | 'patch' | 'file' | 'agent' | 'subtask' })
export interface Message {
  info: Info
  parts: OcPart[]
}
export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: { messageID: string; callID: string }
}
export type Reply = 'once' | 'always' | 'reject'
export interface Agent {
  name: string
  mode: 'primary' | 'subagent' | 'all'
  description?: string
  hidden?: boolean
  native?: boolean
}
export interface ModelEntry {
  id: string
  name: string
  limit: { context: number; output: number }
}
export interface ProviderEntry {
  id: string
  name: string
  models: Record<string, ModelEntry>
}
export interface Providers {
  all: ProviderEntry[]
  connected: string[]
  default: Record<string, string>
}
export type Event =
  | { type: 'session.created' | 'session.updated'; properties: { info: Session } }
  | { type: 'session.deleted'; properties: { info: Session } }
  | { type: 'session.idle'; properties: { sessionID: string } }
  | { type: 'session.status'; properties: { sessionID: string; status: { type: string } } }
  | {
      type: 'session.error'
      properties: { sessionID?: string; error?: { name?: string; data?: { message?: string } } }
    }
  | { type: 'message.updated'; properties: { info: Info } }
  | { type: 'message.part.updated'; properties: { part: OcPart } }
  | {
      type: 'message.part.delta'
      properties: { sessionID: string; messageID: string; partID: string; field: string; delta: string }
    }
  | { type: 'permission.asked'; properties: PermissionRequest }
  | { type: 'permission.replied'; properties: { sessionID: string; requestID: string; reply: Reply } }
