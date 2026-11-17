import type { Limit } from '../../../ai-providers/src/api'
import type { Provider } from '../../../ai-providers/src/api'
import type {
  Command,
  Effort,
  Mode,
  Stop,
  Thread,
  Turn,
  Usage,
} from '../../../ai-providers/src/api'

export interface Once {
  mode?: Mode
  model?: string
  effort?: Effort
  signal?: AbortSignal
}

export interface Ended {
  stop: Stop
  error?: string
  turn: Turn | null
  usage: Usage | null
  limit?: Limit
  outside?: boolean
}

export interface Attached {
  label: string
  text: string
}

export interface Panel {
  send(text: string): void
  newThread(): void
  showThreads(query?: string): void
  rename(name?: string): Promise<void>
  branch(name?: string): void
  exportThread(): Promise<void>
  archive(): void
  remove(): Promise<void>
  stop(): void
  setMode(mode: Mode): void
  openModels(): void
  modelNamed(name: string): boolean
  setEffort(effort: Effort | 'next'): void
  setFast(on?: boolean): void
  compact(focus?: string): void
  openContext(): void
  toggleFolded(): void

  text?: string
  readonly provider?: Provider | null
  ensure?(): Thread
  voice?(on?: boolean): void
  turn?(thread: Thread, text: string, once?: Once): Promise<Ended>
  turnWith?(
    thread: Thread,
    text: string,
    attached: readonly Attached[],
    once?: Once,
  ): Promise<Ended>
  adopt?(thread: Thread, open?: boolean): void
  touched?(thread: Thread): void
  answered?(thread: Thread): void
}

export interface CommandContext {
  args: string
  typed?: string
  thread: Thread | null
  panel: Panel
}

export interface PanelCommand extends Command<CommandContext> {
  description?: string
  source?: string
}
