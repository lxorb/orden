import type {
  Provider,
  Effort,
  ModelInfo,
  Part,
  ToolOutput,
  Usage,
} from '../../../ai-providers/src/api'
import type { Call, Step } from './transcript'

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

export abstract class PartsReader {
  readonly parts: Part[] = []
  protected thinking: { part: number; started: number } | null = null

  constructor(protected readonly window: number | null) {}

  protected add(part: Part): number {
    return this.parts.push(part) - 1
  }

  protected think(words: string): number {
    this.thinking ??= { part: this.add({ kind: 'thinking', text: '', ms: 0 }), started: Date.now() }
    const part = this.parts[this.thinking.part]
    if (part?.kind === 'thinking') {
      part.text += words
      part.ms = Date.now() - this.thinking.started
    }
    return this.thinking.part
  }

  protected say(words: string): number {
    const last = this.parts.at(-1)
    if (last?.kind !== 'text') return this.add({ kind: 'text', text: words })
    last.text += words
    return this.parts.length - 1
  }
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
