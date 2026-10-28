/** What the panel remembers between runs, beside the threads themselves: the mode a new
 *  thread starts in (the last one picked, Approve before any was; docs/ai-sidebar.md
 *  4.1), the effort last used with each model (4.9, Claude Code's `modelSettings`),
 *  which thread was open (one for every space since #332), and whether a tab of the panel shows its rail of
 *  threads. Choices, not words of anybody's, so `localStorage` through stored.ts is the
 *  place. */

import type { Effort } from '../chat/types'
import { isEffort } from '../chat/effort'
import type { Provider } from '../providers'
import { FIRST_MODE, type Mode, modeIn } from '../modes'
import { isRecord, isString, keep, stored } from '../../stored'

const STORAGE_KEY = 'nib:ai-sidebar'

/** The mode a task done with AI works in before anybody picked one (#325). */
const FIRST_TASK_MODE: Mode = 'auto'

/** What a task done with AI may reach, beside its own note and the task itself (#325):
 *  the web, the reader's other notes to look through, and other notes to change. */
export type TaskTool = 'browser' | 'notes' | 'edits'

export const TASK_TOOLS: readonly TaskTool[] = ['browser', 'notes', 'edits']

/** What the model is asked to do before the task, where the reader wrote nothing of their
 *  own in Settings: the placeholder of that field (AiPane.svelte), so it is Orden's words they replace. In
 *  English, for the model. */
export const DEFAULT_ASK = [
  'Do this task from my notes for me.',
  'Read its note first: what is written around and under the task may be what it needs.',
].join(' ')

interface Prefs {
  mode: Mode
  task: Mode
  /** The words a task done with AI is asked in, empty for Orden's own. */
  taskAsk: string
  /** The tools a task done with AI is not given; every one is, until one is turned off. */
  taskOff: TaskTool[]
  efforts: Record<string, Effort>
  /** The thread open last, whichever space it is in. */
  last: string | null
  /** Which thread each space had open, before the panel's chats were one list (#332):
   *  read so the thread somebody had open still opens, and written no more. */
  open: Record<string, string>
  rail: boolean
  /** The model last picked on each provider, which a new thread starts on (#428). */
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
  keep(STORAGE_KEY, JSON.stringify(held()))
}

/** The key a model's effort is filed under: the same model on two providers is two
 *  rows, since the levels each offers are its own. */
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

/** The mode a task done with AI works in: Settings › AI › Do with AI. */
export function taskMode(): Mode {
  return held().task
}

export function rememberTaskMode(mode: Mode): void {
  held().task = mode
  save()
}

/** The words a task done with AI is asked in: the reader's own, or nothing for Orden's. */
export function taskAsk(): string {
  return held().taskAsk
}

export function rememberTaskAsk(words: string): void {
  held().taskAsk = words.trim() ? words : ''
  save()
}

/** Whether a task done with AI is given `tool`. */
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

/** The model a new thread starts on with `provider`: the one last picked on it, else the
 *  one Settings > AI chose for it. */
export function modelFor(provider: Provider): string {
  return held().models[provider.id] ?? provider.model
}

export function rememberModel(provider: string, model: string): void {
  held().models[provider] = model
  save()
}

/** The thread open last, and before there was one for every space, the ones each space
 *  had open: what the panel opens as it starts, in that order. */
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

/** Whether a tab of the panel shows the rail of threads down its left, as ChatGPT's
 *  sidebar stays as it was left. */
export function railOpen(): boolean {
  return held().rail
}

export function rememberRail(open: boolean): void {
  held().rail = open
  save()
}
