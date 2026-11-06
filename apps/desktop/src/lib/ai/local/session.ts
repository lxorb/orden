import { identifier } from '../../identifier'
import { Channel } from '../../native'
import { invoke } from '../../tauri'
import { READER_TABS } from '../chat/choices'
import type { Mode } from '../modes'
import type { LocalKind } from '../providers'
import type { Ending } from './trouble'

type ToolsOf = Mode | null

export type Level = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface Opening {
  tool: LocalKind
  agent: { id: string; name: string }
  mode: ToolsOf
  model: string | null
  effort: Level | null
  forkOf?: string
  thread?: string
  without?: string[]
}

interface Picture {
  mime: string
  data: string
}

export type Say =
  | { kind: 'turn'; text: string; images: Picture[] }
  | { kind: 'steer'; text: string }
  | { kind: 'interrupt' }
  | { kind: 'model'; model: string }
  | { kind: 'effort'; effort: Level | null }
  | { kind: 'fast'; on: boolean }
  | { kind: 'compact'; focus: string }
  | { kind: 'context' }
  | {
      kind: 'goal'
      goal:
        | { do: 'set'; objective: string; budget?: number }
        | { do: 'pause' | 'resume' | 'clear' | 'get' }
    }

export type Heard =
  | { kind: 'line'; line: string }
  | { kind: 'reply'; to: string; result: unknown; error: string | null }
  | { kind: 'end'; end: Ending }

export function heardIn(value: unknown): Heard | null {
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  if (said.kind === 'line' && typeof said.line === 'string')
    return { kind: 'line', line: said.line }
  if (said.kind === 'reply' && typeof said.to === 'string') {
    return {
      kind: 'reply',
      to: said.to,
      result: said.result ?? null,
      error: typeof said.error === 'string' ? said.error : null,
    }
  }
  if (said.kind !== 'end') return null
  return {
    kind: 'end',
    end: {
      code: typeof said.code === 'number' ? said.code : null,
      timedOut: said.timedOut === true,
      stopped: said.stopped === true,
      err: typeof said.err === 'string' ? said.err : '',
    },
  }
}

export interface Session {
  readonly id: string
  readonly opening: Opening
  readonly ended: boolean
  say(say: Say): Promise<void>
  close(): Promise<void>
}

export async function openSession(
  opening: Opening,
  heard: (said: Heard) => void,
): Promise<Session> {
  const id = `s-${identifier()}`
  let ended = false
  const channel = new Channel<unknown>()
  channel.onmessage = (value) => {
    const said = heardIn(value)
    if (!said) return
    if (said.kind === 'end') ended = true
    heard(said)
  }
  await invoke('ai_cli_open', {
    id,
    opening: {
      tool: opening.tool,
      agent: { ...opening.agent, readerTabs: READER_TABS },
      mode: opening.mode,
      model: opening.model,
      effort: opening.effort,
      ...(opening.forkOf ? { forkOf: opening.forkOf } : {}),
      account: opening.agent.id,
      ...(opening.thread ? { thread: opening.thread } : {}),
      ...(opening.without?.length ? { without: opening.without } : {}),
    },
    output: channel,
  })
  let last: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const next = last.then(run)
    last = next.catch(() => undefined)
    return next
  }
  return {
    id,
    opening,
    get ended() {
      return ended
    },
    async say(say) {
      await inTurn(() => invoke('ai_cli_say', { id, say }))
    },
    async close() {
      ended = true
      await inTurn(() => invoke('ai_cli_close', { id })).catch(() => undefined)
    },
  }
}

export async function listedModels(tool: LocalKind, account: string): Promise<unknown> {
  return await invoke<unknown>('ai_cli_models', { tool, account })
}
