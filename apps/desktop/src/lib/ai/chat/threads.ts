import { without } from '../../records'
import { isNumber, isRecord, isString } from '../../stored'
import { isNative, invoke } from '../../tauri'
import { FIRST_MODE, modeIn } from '../modes'
import { windows } from '../../windows'
import { isSessionState, type SessionState } from '../session-state'
import { isEffort } from './effort'
import type {
  Compaction,
  Effort,
  Mode,
  NoticeCode,
  Part,
  Thread,
  ThreadHead,
  ToolOutput,
  ToolState,
  Turn,
  Usage,
} from './types'
import { noUsage } from './usage'

const WORDS = 2_000

export function newThread(
  space: string,
  provider: string,
  model: string,
  effort: Effort = 'auto',
  mode: Mode = FIRST_MODE,
): Thread {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    space,
    title: '',
    provider,
    model,
    effort,
    mode,
    turns: [],
    usage: noUsage(null),
    created: now,
    updated: now,
  }
}

export function wordsOf(thread: Thread): string {
  return thread.turns
    .flatMap((turn) => [
      turn.draft?.text ?? '',
      ...turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])),
    ])
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, WORDS)
}

export function headOf(thread: Thread, words = wordsOf(thread)): ThreadHead {
  return {
    id: thread.id,
    title: thread.title,
    ...(thread.parent ? { parent: thread.parent } : {}),
    ...(thread.answered ? { answered: thread.answered } : {}),
    ...(thread.seen ? { seen: thread.seen } : {}),
    provider: thread.provider,
    model: thread.model,
    updated: thread.updated,
    ...(thread.archived ? { archived: true } : {}),
    ...(thread.state ? { state: thread.state } : {}),
    ...(thread.pinned ? { pinned: thread.pinned } : {}),
    words,
  }
}

export function chatsOf<T extends ThreadHead>(heads: readonly T[]): T[] {
  const ids = new Set(heads.map((one) => one.id))
  return heads.filter((one) => !one.parent || !ids.has(one.parent))
}

function copied<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function branchThread(thread: Thread, upTo: string, title?: string): Thread {
  const copy = copied(thread)
  const at = copy.turns.findIndex((one) => one.id === upTo)
  if (at >= 0) copy.turns = copy.turns.slice(0, at + 1)
  if (copy.compaction && !copy.turns.some((one) => one.id === copy.compaction?.upTo)) {
    delete copy.compaction
  }
  delete copy.goal
  delete (copy as Thread & { helpers?: string[] }).helpers
  delete copy.parent
  Object.assign(copy, copy.own)
  delete copy.own
  delete copy.answering
  delete copy.elsewhere
  const now = Date.now()
  return {
    ...copy,
    id: crypto.randomUUID(),
    title: title ?? thread.title,
    created: now,
    updated: now,
  }
}

function usageIn(value: unknown): Usage {
  if (!isRecord(value)) return noUsage(null)
  const number = (one: unknown) => (isNumber(one) ? one : 0)
  return {
    input: number(value.input),
    cached: number(value.cached),
    output: number(value.output),
    reasoning: number(value.reasoning),
    window: isNumber(value.window) ? value.window : null,
    ...(isNumber(value.cost) ? { cost: value.cost } : {}),
  }
}

const NOTICES: readonly NoticeCode[] = [
  'compacted',
  'model',
  'steps',
  'max_tokens',
  'refusal',
  'error',
  'stopped',
  'no_tools',
  'command',
  'tasks',
]
const STATES: readonly ToolState[] = ['running', 'ok', 'error', 'asking']

function outputIn(value: unknown): ToolOutput | undefined {
  if (!isRecord(value)) return undefined
  const images = Array.isArray(value.images)
    ? value.images.flatMap((one) =>
        isRecord(one) && isString(one.mime) && isString(one.data)
          ? [{ mime: one.mime, data: one.data }]
          : [],
      )
    : []
  return {
    text: isString(value.text) ? value.text : '',
    images,
    error: value.error === true,
    ...(isString(value.approval) ? { approval: value.approval } : {}),
    ...(isString(value.category) ? { category: value.category } : {}),
    ...(isString(value.site) ? { site: value.site } : {}),
    ...(isString(value.agent) ? { agent: value.agent } : {}),
  }
}

function partIn(value: unknown): Part | null {
  if (!isRecord(value)) return null
  const { kind, text } = value
  if (kind === 'text') return isString(text) ? { kind, text } : null
  if (kind === 'thinking')
    return isString(text) ? { kind, text, ms: isNumber(value.ms) ? value.ms : 0 } : null
  if (kind === 'notice') {
    const code = NOTICES.find((one) => one === value.code)
    const threads = Array.isArray(value.threads) ? value.threads.filter(isString) : []
    return code
      ? { kind, code, text: isString(text) ? text : '', ...(threads.length ? { threads } : {}) }
      : null
  }
  if (kind !== 'tool' || !isString(value.id) || !isString(value.verb)) return null
  const state = STATES.find((one) => one === value.state && one !== 'running') ?? 'error'
  const result = outputIn(value.result)
  const change = isRecord(value.change) && isString(value.change.path) ? value.change : null
  return {
    kind,
    id: value.id,
    verb: value.verb,
    args: value.args ?? {},
    state,
    ...(typeof value.at === 'number' ? { at: value.at } : {}),
    ...(result ? { result } : {}),
    ...(change
      ? {
          change: {
            path: isString(change.path) ? change.path : '',
            added: isNumber(change.added) ? change.added : 0,
            removed: isNumber(change.removed) ? change.removed : 0,
          },
        }
      : {}),
  }
}

function turnIn(value: unknown): Turn | null {
  if (!isRecord(value) || !isString(value.id) || (value.role !== 'you' && value.role !== 'model')) {
    return null
  }
  const parts = Array.isArray(value.parts)
    ? value.parts.map(partIn).filter((one) => one !== null)
    : []
  const turn = { ...(value as unknown as Turn), parts, at: isNumber(value.at) ? value.at : 0 }
  if (!isString(turn.context)) delete turn.context
  return turn
}

const GONE_AFTER = 3 * 60_000

function thisWindow(): string {
  try {
    const held = sessionStorage.getItem(WINDOW_KEY)
    if (held) return held
    const made = crypto.randomUUID()
    sessionStorage.setItem(WINDOW_KEY, made)
    return made
  } catch {
    return THIS_PAGE
  }
}

const WINDOW_KEY = 'nib:ai-window'
const THIS_PAGE = crypto.randomUUID()

function answeredElsewhere(value: Record<string, unknown>): boolean {
  const { answeringAt, answeringIn } = value
  return (
    isString(answeringIn) &&
    answeringIn !== thisWindow() &&
    isNumber(answeringAt) &&
    Date.now() - answeringAt < GONE_AFTER
  )
}

function cutOff(turns: Turn[], answering: string): void {
  const turn = turns.find((one) => one.id === answering)
  if (!turn || turn.parts.some((one) => one.kind === 'notice' && ENDED.has(one.code))) return
  turn.parts.push({ kind: 'notice', code: 'stopped', text: '' })
}

const ENDED: ReadonlySet<NoticeCode> = new Set<NoticeCode>([
  'stopped',
  'error',
  'steps',
  'max_tokens',
  'refusal',
])

const SAYS_WITHIN = 1_500

const answeringHere = new Map<string, Thread>()

function saidAnswering(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    const stop = windows.hear('thread-answering', (said) => {
      if (said.id !== id) return
      clearTimeout(timer)
      stop()
      resolve(true)
    })
    const timer = setTimeout(() => {
      stop()
      resolve(false)
    }, SAYS_WITHIN)
    windows.say('thread-answering?', { id })
  })
}

let answersOthers = false
function answerOthers(): void {
  if (answersOthers) return
  answersOthers = true
  windows.hear('thread-answering?', (said) => {
    if (typeof said.id === 'string' && answeringHere.has(said.id)) {
      windows.say('thread-answering', { id: said.id })
    }
  })
  windows.hear('thread-fields', (said) => {
    const thread = typeof said.id === 'string' ? answeringHere.get(said.id) : undefined
    if (!thread || !isRecord(said.fields)) return
    Object.assign(thread, said.fields)
    void keepThread(thread).catch(() => undefined)
  })
}

export function otherWindowWrote(listener: (id: string) => void): () => void {
  return windows.hear('thread-written', (said) => {
    if (typeof said.id === 'string') listener(said.id)
  })
}

function ownFields(thread: Thread): Record<string, unknown> {
  const fields = {
    ...thread,
    ...thread.own,
    turns: undefined,
    own: undefined,
    elsewhere: undefined,
    answering: undefined,
  }
  return JSON.parse(JSON.stringify(fields)) as Record<string, unknown>
}

const readHere = new Map<string, Record<string, unknown>>()

function changedHere(thread: Thread): Record<string, unknown> {
  const fields = ownFields(thread)
  const read = readHere.get(thread.id) ?? {}
  readHere.set(thread.id, fields)
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([name, value]) => JSON.stringify(value) !== JSON.stringify(read[name]),
    ),
  )
}

export function threadIn(value: unknown, gone = false): Thread | null {
  if (!isRecord(value)) return null
  const { id, space, title, provider, model, effort, mode } = value
  if (!isString(id) || !isString(space) || !isString(provider) || !isString(model)) return null
  const turns = Array.isArray(value.turns)
    ? value.turns.map(turnIn).filter((one): one is Turn => one !== null)
    : []
  const elsewhere = !gone && isString(value.answering) && answeredElsewhere(value)
  if (isString(value.answering) && !elsewhere) cutOff(turns, value.answering)
  const compaction =
    isRecord(value.compaction) && isString(value.compaction.upTo)
      ? (value.compaction as unknown as Compaction)
      : undefined
  const always = Array.isArray(value.always) ? value.always.filter(isString) : []
  const kept = Array.isArray(value.without) ? value.without.filter(isString) : []
  const rest = [
    'always',
    'without',
    'parent',
    'answered',
    'seen',
    'answering',
    'answeringAt',
    'answeringIn',
    'elsewhere',
    'state',
    'pinned',
  ].reduce(without, value)
  return {
    ...(rest as unknown as Thread),
    id,
    space,
    title: isString(title) ? title : '',
    ...(isString(value.parent) && value.parent ? { parent: value.parent } : {}),
    ...timesIn(value),
    ...placeIn(value),
    provider,
    model,
    effort: isEffort(effort) ? effort : 'auto',
    mode: modeIn(mode) ?? FIRST_MODE,
    ...(always.length ? { always } : {}),
    ...(kept.length ? { without: kept } : {}),
    turns,
    usage: usageIn(value.usage),
    created: isNumber(value.created) ? value.created : 0,
    updated: isNumber(value.updated) ? value.updated : 0,
    ...(compaction ? { compaction } : {}),
    ...(elsewhere ? { elsewhere } : {}),
  }
}

function timesIn(value: Record<string, unknown>): { answered?: number; seen?: number } {
  return {
    ...(isNumber(value.answered) ? { answered: value.answered } : {}),
    ...(isNumber(value.seen) ? { seen: value.seen } : {}),
  }
}

function placeIn(value: Record<string, unknown>): { state?: SessionState; pinned?: number } {
  return {
    ...(isSessionState(value.state) ? { state: value.state } : {}),
    ...(isNumber(value.pinned) ? { pinned: value.pinned } : {}),
  }
}

function headIn(value: unknown): ThreadHead | null {
  if (!isRecord(value) || !isString(value.id)) return null
  return {
    id: value.id,
    title: isString(value.title) ? value.title : '',
    ...(isString(value.parent) && value.parent ? { parent: value.parent } : {}),
    ...timesIn(value),
    provider: isString(value.provider) ? value.provider : '',
    model: isString(value.model) ? value.model : '',
    updated: isNumber(value.updated) ? value.updated : 0,
    ...(value.archived === true ? { archived: true } : {}),
    ...placeIn(value),
    ...(answeredElsewhere(value) ? { elsewhere: true } : {}),
    words: isString(value.words) ? value.words : '',
  }
}

async function web() {
  const { meta } = await import('../../web/store')
  const listKey = (space: string) => `ai-threads:${space}`
  const threadKey = (space: string, id: string) => `ai-thread:${space}:${id}`
  const heads = async (space: string): Promise<unknown[]> => {
    const raw = await meta.get(listKey(space))
    try {
      const read: unknown = raw ? JSON.parse(raw) : []
      const list: unknown[] = Array.isArray(read) ? read : []
      return list
    } catch {
      return []
    }
  }
  return { meta, listKey, threadKey, heads }
}

export async function listThreads(space: string): Promise<ThreadHead[]> {
  const read = isNative
    ? await invoke<unknown>('ai_threads_list', { space })
    : await (await web()).heads(space)
  const heads = Array.isArray(read) ? read.map(headIn).filter((one) => one !== null) : []
  return heads.sort((a, b) => b.updated - a.updated)
}

export type Listed = ThreadHead & { space: string }

export async function listEveryThread(spaces: readonly string[]): Promise<Listed[]> {
  const each = await Promise.all(
    [...new Set(spaces)].map(async (space) =>
      (await listThreads(space).catch(() => [])).map((head) => ({ ...head, space })),
    ),
  )
  return each.flat().sort((a, b) => b.updated - a.updated)
}

export async function findParents(space: string): Promise<number> {
  const threads = new Map<string, Thread & { helpers?: unknown }>()
  for (const head of await listThreads(space)) {
    const thread = await readThread(space, head.id).catch(() => null)
    if (thread) threads.set(thread.id, thread)
  }
  const holders = new Map<string, string[]>()
  for (const thread of threads.values()) {
    const under = Array.isArray(thread.helpers) ? thread.helpers.filter(isString) : []
    for (const child of under) holders.set(child, [...(holders.get(child) ?? []), thread.id])
  }
  const depth = (id: string) => holders.get(id)?.length ?? 0
  let wrote = 0
  for (const [id, above] of holders) {
    const child = threads.get(id)
    if (!child || child.parent || above.includes(id)) continue
    const parent = above.reduce((best, one) => (depth(one) > depth(best) ? one : best))
    const title = threads.get(parent)?.title
    if (title !== undefined && child.title === title && !child.title.startsWith('↳')) continue
    child.parent = parent
    await keepThread(child)
    wrote++
  }
  return wrote
}

export function unreadOf(heads: readonly ThreadHead[]): Set<string> {
  const byId = new Map(heads.map((one) => [one.id, one]))
  const topOf = (head: ThreadHead): ThreadHead => {
    let at = head
    for (const passed = new Set<string>(); at.parent && !passed.has(at.id);) {
      passed.add(at.id)
      const above = byId.get(at.parent)
      if (!above) break
      at = above
    }
    return at
  }
  const unread = new Set<string>()
  for (const head of heads) {
    if (!head.answered) continue
    const top = topOf(head)
    if (head.answered > (top.seen ?? 0)) unread.add(top.id)
  }
  return unread
}

export async function readThread(space: string, id: string): Promise<Thread | null> {
  let text: string | null
  if (isNative) {
    text = await invoke<string | null>('ai_thread_read', { space, id })
  } else {
    const store = await web()
    text = (await store.meta.get(store.threadKey(space, id))) ?? null
  }
  if (!text) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const thread = threadIn(value)
  if (!thread?.elsewhere) return thread
  if (await saidAnswering(id)) {
    readHere.set(id, ownFields(thread))
    return thread
  }
  readHere.delete(id)
  return threadIn(value, true)
}

function aliveIn(thread: Thread): { answeringAt?: number; answeringIn?: string } {
  return thread.answering ? { answeringAt: Date.now(), answeringIn: thisWindow() } : {}
}

function asWritten({ own, ...thread }: Thread): Thread {
  return { ...thread, ...own, ...aliveIn(thread) }
}

export async function writeThread(given: Thread): Promise<void> {
  const thread = asWritten(given)
  const head = { ...headOf(thread), ...aliveIn(thread) }
  const body = JSON.stringify(thread)
  if (isNative) {
    await invoke<null>('ai_thread_write', { space: thread.space, id: thread.id, head, body })
    return
  }
  const store = await web()
  await store.meta.put(store.threadKey(thread.space, thread.id), body)
  const others = (await store.heads(thread.space)).filter((one) => headIn(one)?.id !== thread.id)
  await store.meta.put(store.listKey(thread.space), JSON.stringify([...others, head]))
}

const removed = new Set<string>()

export function isDeleted(id: string): boolean {
  return removed.has(id)
}

const deleting = new Map<string, Promise<void>>()

export async function staysDeleted(id: string): Promise<boolean> {
  await deleting.get(id)?.catch(() => undefined)
  return removed.has(id)
}

export function deleteThread(space: string, id: string): Promise<void> {
  removed.add(id)
  const done = (async () => {
    try {
      await writing.get(id)?.done.catch(() => undefined)
      await deleted(space, id)
    } catch (error) {
      removed.delete(id)
      throw error
    } finally {
      deleting.delete(id)
    }
  })()
  deleting.set(id, done)
  return done
}

async function deleted(space: string, id: string): Promise<void> {
  if (isNative) {
    await invoke<null>('ai_thread_delete', { space, id })
    return
  }
  const store = await web()
  await store.meta.remove(store.threadKey(space, id))
  const left = (await store.heads(space)).filter((one) => headIn(one)?.id !== id)
  await store.meta.put(store.listKey(space), JSON.stringify(left))
}

export async function forgetSpace(space: string): Promise<void> {
  if (isNative) {
    await invoke<null>('ai_threads_forget', { space })
    return
  }
  const store = await web()
  for (const head of await store.heads(space)) {
    const id = headIn(head)?.id
    if (id) await store.meta.remove(store.threadKey(space, id))
  }
  await store.meta.remove(store.listKey(space))
}

const writing = new Map<string, { next: boolean; thread: Thread; done: Promise<void> }>()

function again(entry: { next: boolean }): boolean {
  return entry.next
}

export function keepThread(thread: Thread): Promise<void> {
  if (removed.has(thread.id)) return Promise.resolve()
  answerOthers()
  if (thread.elsewhere) {
    const fields = changedHere(thread)
    if (Object.keys(fields).length) windows.say('thread-fields', { id: thread.id, fields })
    return Promise.resolve()
  }
  const answered = answeringHere.has(thread.id)
  if (thread.answering) answeringHere.set(thread.id, thread)
  else answeringHere.delete(thread.id)
  const tell = answered || !!thread.answering
  const held = writing.get(thread.id)
  if (held) {
    held.next = true
    held.thread = thread
    return held.done
  }
  const entry = { next: false, thread, done: Promise.resolve() }
  entry.done = (async () => {
    try {
      do {
        entry.next = false
        const latest = entry.thread
        await writeThread(latest)
        if (tell || latest.answering) windows.say('thread-written', { id: latest.id })
      } while (again(entry) && !removed.has(thread.id))
    } finally {
      writing.delete(thread.id)
    }
  })()
  writing.set(thread.id, entry)
  return entry.done
}
