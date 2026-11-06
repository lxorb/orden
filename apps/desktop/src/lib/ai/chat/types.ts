import type { Limit } from '../local/heard'
import type { Mode } from '../modes'
import type { SessionState } from '../session-state'
import type { Provider, ProviderKind } from '../providers'

export type { Mode }

export type Effort = 'auto' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface ModelInfo {
  id: string
  name: string
  window: number | null
  efforts: Effort[]
  images: boolean
  fast: boolean
  output?: number
  thinking?: boolean
  compaction?: boolean
}

export interface Usage {
  input: number
  cached: number
  output: number
  reasoning: number
  window: number | null
  cost?: number
}

export type ToolState = 'running' | 'ok' | 'error' | 'asking'

export interface ToolOutput {
  text: string
  images: { mime: string; data: string }[]
  error: boolean
  approval?: string
  category?: string
  site?: string
  agent?: string
}

export type NoticeCode =
  | 'compacted'
  | 'model'
  | 'steps'
  | 'max_tokens'
  | 'refusal'
  | 'error'
  | 'stopped'
  | 'no_tools'
  | 'command'
  | 'tasks'

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; ms: number }
  | {
      kind: 'tool'
      id: string
      verb: string
      args: unknown
      state: ToolState
      result?: ToolOutput
      change?: { path: string; added: number; removed: number }
      at?: number
    }
  | { kind: 'notice'; code: NoticeCode; text: string; threads?: string[] }

export interface Attachment {
  label: string
  text?: string
  image?: { mime: string; data: string }
  untrusted?: boolean
}

export interface Draft {
  text: string
  attachments: Attachment[]
  web?: boolean
}

/** @public */
export interface Replay {
  api: Api
  model: string
  messages: unknown[]
}

export type Api = 'anthropic' | 'responses' | 'completions' | 'gemini'

export interface Turn {
  id: string
  role: 'you' | 'model'
  at: number
  draft?: Draft
  steered?: boolean
  context?: string
  parts: Part[]
  provider?: string
  model?: string
  effort?: Effort
  usage?: Usage
  replay?: Replay
  took?: number
}

/** @public */
export type GoalState = 'pursuing' | 'paused' | 'met' | 'impossible' | 'budget_limited' | 'cleared'

/** @public */
export interface Goal {
  condition: string
  state: GoalState
  started: number
  turns: number
  tokens: number
  budget: { turns: number; tokens?: number; ms?: number }
  reason?: string
}

export type GoalTo =
  | { do: 'set'; condition: string; tokens?: number }
  | { do: 'resume'; condition: string; text: string }
  | { do: 'pause' }
  | { do: 'clear' }

export interface Compaction {
  upTo: string
  kind: Api | 'summary'
  model: string
  summary: string
  block?: unknown
}

export type AutoCompact = 'auto' | 'off' | number

export interface Thread {
  id: string
  space: string
  title: string
  parent?: string
  answered?: number
  seen?: number
  answering?: string
  own?: Pick<Thread, 'mode' | 'model' | 'effort'>
  elsewhere?: boolean
  provider: string
  model: string
  effort: Effort
  mode: Mode
  always?: string[]
  without?: string[]
  turns: Turn[]
  goal?: Goal
  usage: Usage
  created: number
  updated: number
  fast?: boolean
  archived?: boolean
  state?: SessionState
  pinned?: number
  compaction?: Compaction
  autocompact?: AutoCompact
  spent?: { input: number; output: number; cost?: number }
}

export interface ThreadHead {
  id: string
  title: string
  parent?: string
  answered?: number
  seen?: number
  provider: string
  model: string
  updated: number
  archived?: boolean
  state?: SessionState
  pinned?: number
  elsewhere?: boolean
  words: string
}

export type EngineEvent =
  | { type: 'part'; turn: string; index: number; part: Part }
  | { type: 'usage'; usage: Usage }
  | { type: 'model'; model: string }
  | { type: 'limit'; limit: Limit }
  | { type: 'turn'; turn: Turn }
  | { type: 'done'; stop: Stop; error?: string }

export type Stop = 'end' | 'stopped' | 'max_tokens' | 'refusal' | 'steps' | 'error'

export interface Engine {
  models(provider: Provider): Promise<ModelInfo[]>
  send(
    thread: Thread,
    message: Draft,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<void>
  goal?(
    thread: Thread,
    to: GoalTo,
    on: (event: EngineEvent) => void,
    signal: AbortSignal,
  ): Promise<GoalState | null>
  steer(thread: Thread, text: string): Promise<boolean>
  compact(thread: Thread, focus?: string): Promise<void>
  rewound?(thread: Thread): void
}

/** @public */
export interface Checkpoint {
  turn: string
  notes: { path: string; rev: number; steps: number }[]
}

/** @public */
export interface Command<Context = unknown> {
  name: string
  synonyms: string[]
  args?: string
  available(provider: ProviderKind): true | string
  run(context: Context): void | Promise<void>
}
