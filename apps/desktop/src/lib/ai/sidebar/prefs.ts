import type { Effort } from '../chat/types'
import { isEffort } from '../chat/effort'
import type { Provider } from '../providers'
import { FIRST_MODE, type Mode, modeIn } from '../modes'
import { isRecord, isString, keepJson, stored } from '../../platform/src/api'

const STORAGE_KEY = 'orden:ai-sidebar'

const FIRST_TASK_MODE: Mode = 'auto'

export type TaskTool = 'browser' | 'notes' | 'edits'

export const TASK_TOOLS: readonly TaskTool[] = ['browser', 'notes', 'edits']

export const DEFAULT_ASK = [
  'Do this task from my notes for me.',
  'Read its note first: what is written around and under the task may be what it needs.',
].join(' ')

interface Prefs {
  mode: Mode
  task: Mode
  taskAsk: string
  taskOff: TaskTool[]
  efforts: Record<string, Effort>
  last: string | null
  open: Record<string, string>
  rail: boolean
  models: Record<string, string>
}

function read(): Prefs {
  const saved = stored(STORAGE_KEY)
  const out: Prefs = {
    mode: FIRST_MODE,
    task: FIRST_TASK_MODE,
    taskAsk: '',
    taskOff: [],
    efforts: {},
    last: null,
    open: {},
    rail: true,
    models: {},
  }
  if (!isRecord(saved)) return out
  if (saved.rail === false) out.rail = false
  out.mode = modeIn(saved.mode) ?? FIRST_MODE
  out.task = modeIn(saved.task) ?? FIRST_TASK_MODE
  if (isString(saved.taskAsk)) out.taskAsk = saved.taskAsk
  if (Array.isArray(saved.taskOff)) {
    out.taskOff = TASK_TOOLS.filter((one) => (saved.taskOff as unknown[]).includes(one))
  }
  if (isRecord(saved.efforts)) {
    for (const [model, effort] of Object.entries(saved.efforts)) {
      if (isEffort(effort)) out.efforts[model] = effort
    }
  }
  if (isString(saved.last)) out.last = saved.last
  if (isRecord(saved.open)) {
    for (const [space, id] of Object.entries(saved.open)) if (isString(id)) out.open[space] = id
  }
  if (isRecord(saved.models)) {
    for (const [provider, model] of Object.entries(saved.models)) {
      if (isString(model)) out.models[provider] = model
    }
  }
  return out
}

let prefs: Prefs | null = null

function held(): Prefs {
  prefs ??= read()
  return prefs
}

function save(): void {
  keepJson(STORAGE_KEY, held())
}

function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

export function lastMode(): Mode {
  return held().mode
}

export function rememberMode(mode: Mode): void {
  held().mode = mode
  save()
}

export function taskMode(): Mode {
  return held().task
}

export function rememberTaskMode(mode: Mode): void {
  held().task = mode
  save()
}

export function taskAsk(): string {
  return held().taskAsk
}

export function rememberTaskAsk(words: string): void {
  held().taskAsk = words.trim() ? words : ''
  save()
}

export function taskUses(tool: TaskTool): boolean {
  return !held().taskOff.includes(tool)
}

export function rememberTaskUses(tool: TaskTool, on: boolean): void {
  const off = held().taskOff.filter((one) => one !== tool)
  held().taskOff = on ? off : [...off, tool]
  save()
}

export function effortFor(provider: string, model: string): Effort {
  return held().efforts[modelKey(provider, model)] ?? 'auto'
}

export function rememberEffort(provider: string, model: string, effort: Effort): void {
  held().efforts[modelKey(provider, model)] = effort
  save()
}

export function modelFor(provider: Provider): string {
  return held().models[provider.id] ?? provider.model
}

export function rememberModel(provider: string, model: string): void {
  held().models[provider] = model
  save()
}

export function lastOpen(): { last: string | null; before: readonly string[] } {
  const prefs = held()
  return { last: prefs.last, before: Object.values(prefs.open) }
}

export function rememberOpen(id: string | null): void {
  const prefs = held()
  prefs.last = id
  prefs.open = {}
  save()
}

export function railOpen(): boolean {
  return held().rail
}

export function rememberRail(open: boolean): void {
  held().rail = open
  save()
}
