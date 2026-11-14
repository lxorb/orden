import type { Provider } from '../../ai-providers/src/api'
import type { Call, Step } from './transcript'
import type { Effort, ModelInfo, Part, ToolOutput, Usage } from '../../ai-providers/src/api'

export interface ToolDef {
  name: string
  description: string
  inputSchema: unknown
  annotations?: { readOnlyHint?: boolean } & Record<string, unknown>
}

export interface Ask {
  provider: Provider
  model: ModelInfo
  effort: Effort
  base?: Effort
  fast: boolean
  system: string
  tools: ToolDef[]
  steps: Step[]
  added: unknown[]
  web: boolean
  perMessage: boolean
}

export type Ending = 'end' | 'tool' | 'max_tokens' | 'refusal' | 'pause'

export interface Answer {
  messages: unknown[]
  calls: Call[]
  ending: Ending
  refusal?: string
}

export interface Heard {
  changed: number[]
  model?: string
  usage?: Usage
  trouble?: unknown
}

export interface Reader {
  readonly parts: Part[]
  heard(event: unknown): Heard
  finished(saidDone: boolean): boolean
  answer(): Answer
}

export interface Wire {
  request(ask: Ask): { url: string; body: unknown; headers: Record<string, string> }
  reader(window: number | null): Reader
  results(results: { call: Call; output: ToolOutput }[]): unknown[]
}

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function argsOf(json: string): unknown {
  if (!json.trim()) return {}
  try {
    return JSON.parse(json) as unknown
  } catch {
    return json
  }
}

export function bareName(name: string): string {
  return name.replace(/^(?:orden|nib)[.:_]{1,2}/, '')
}
