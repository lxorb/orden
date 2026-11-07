import { untrack } from 'svelte'
import { answerThreadSpaces } from '../../automation/caller'
import { i18n, message, t } from '../../i18n.svelte'
import { owes, writing } from '../../parting'
import { prompt } from '../../prompt.svelte'
import { without } from '../../records'
import { forget, keep, keepJson, stored, storedText } from '../../stored'
import { afterQuiet, onceAFrame } from '../../timing'
import { workspace } from '../../workspace.svelte'
import { unlisted } from '../chat/catalogue'
import { nextEffort, within } from '../chat/effort'
import {
  answerFreed,
  branchThread,
  chatsOf,
  claimAnswer,
  deleteThread,
  findParents,
  headOf as listedHeadOf,
  unreadOf,
  wordsOf,
  isDeleted,
  staysDeleted,
  keepThread,
  listEveryThread,
  type Listed,
  newThread,
  otherWindowDeleted,
  otherWindowWrote,
  readThread,
  unclaimAnswer,
} from '../chat/threads'
import type {
  Draft,
  Effort,
  EngineEvent,
  Goal,
  Mode,
  ModelInfo,
  Part,
  Stop,
  Thread,
  Turn,
  Usage,
} from '../chat/types'
import { added, noUsage } from '../chat/usage'
import { nextMode } from '../modes'
import type { Provider } from '../providers'
import { ai } from '../store.svelte'
import { tasks } from '../commands/tasks.svelte'
import {
  FIRST_STATE,
  next as nextState,
  type SessionEvent,
  type SessionState,
  statesOf,
} from '../session-state'
import { chatsUnread, panelKeepsUnread } from '../unread.svelte'
import { threadMarkdown } from './export'
import { readOutside } from '../chat/transcript'
import { draftOf, type Front, type Picked } from './gather'
import type { Mention } from './mentions'
import { OLD_KEY, oldSpaces, threadFromAsk } from './migrate'
import {
  effortFor,
  lastMode,
  lastOpen,
  modelFor,
  rememberEffort,
  rememberMode,
  rememberModel,
  rememberOpen,
} from './prefs'
import type { Attached, Ended, Once, Panel } from '../commands/types'
import { engineOf } from './setup'
import { snapshot } from './snapshot'
import { tokens } from './numbers'
import { switchCost } from '../switch-cost'
import { editMessage, lastMessage, openRewind } from '../review'
import { agentOpen } from './agent-open.svelte'

const AFTER_RESET = 30_000

const KEEP_QUIET = 1_000
const KEEP_AT_MOST = 3_000

const ANSWER_BEAT = 30_000

export interface Queued {
  id: string
  text: string
  chips: Mention[]
  around: Around
  once?: Once
  settle?: (ended: Ended) => void
}

export interface Head {
  id: string
  title: string
  parent: string | null
  provider: string
  model: string
  effort: Effort
  mode: Mode
  fast: boolean
  usage: Usage
  archived: boolean
  goal: Goal | null
  kept: boolean
}

export type Host = 'side' | 'tab'

export interface Around {
  front: Front | null
  selection: string
  picked?: Picked | null
}

function headOf(thread: Thread): Head {
  return {
    id: thread.id,
    title: thread.title,
    parent: thread.parent ?? null,
    provider: thread.provider,
    model: thread.model,
    effort: thread.effort,
    mode: thread.mode,
    fast: !!thread.fast,
    usage: { ...thread.usage },
    archived: !!thread.archived,
    goal: thread.goal ? { ...thread.goal, budget: { ...thread.goal.budget } } : null,
    kept: thread.turns.length > 0,
  }
}

const SWITCH_KEY = 'orden:ai-switch-asks'

const PARENTS_KEY = 'orden:ai-helpers-parented'

class Chat implements Panel {
  every = $state.raw<Listed[]>([])
  heads = $derived(chatsOf(this.every))
  unread = $derived(unreadOf(this.every))
  states = $derived(statesOf(this.every))
  head = $state.raw<Head | null>(null)
  turns = $state.raw<Turn[]>([])
  running = $state.raw<readonly string[]>([])
  pending = $state.raw<Record<string, string>>({})
  queued = $state.raw<Record<string, Queued[]>>({})
  steering = $state.raw<Record<string, string[]>>({})
  trouble = $state<string | null>(null)
  resets = $state.raw<Record<string, { until: number; waiting: boolean }>>({})

  text = $state('')
  chips = $state.raw<Mention[]>([])
  dropped = $state.raw<readonly string[]>([])

  listing = $state(false)
  popover = $state<'model' | 'context' | null>(null)
  unfolded = $state(false)
  models = $state.raw<Record<string, ModelInfo[]>>({})
  focusAsked = $state(0)
  host = $state<Host>('side')

  private spaces: readonly string[] = []
  private space = ''
  private started = false
  private live = new Map<string, Thread>()
  private open: Thread | null = null
  private stoppers = new Map<string, AbortController>()
  private following = new Set<string>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private changed = new Set<string>()
  private everything = false
  private readonly draw = onceAFrame(() => this.redraw())
  private asking = new Map<string, Promise<ModelInfo[]>>()

  get thread(): Thread | null {
    return this.open
  }

  get root(): string | null {
    return this.open
      ? (spaceOfThread(this.open)?.root ?? null)
      : (workspace.activeSpace?.root ?? null)
  }

  threadOf(id: string): Thread | null {
    return this.live.get(id) ?? (this.open?.id === id ? this.open : null)
  }

  private providerForNew(): Provider | null {
    return ai.providerFor('ask')
  }

  get provider(): Provider | null {
    const id = this.head?.provider
    return (id ? ai.provider(id) : null) ?? this.providerForNew()
  }

  get model(): ModelInfo | null {
    const head = this.head
    const provider = this.provider
    if (!head || !provider) return null
    return (
      this.models[provider.id]?.find((one) => one.id === head.model) ??
      unlisted(provider, head.model)
    )
  }

  know(spaces: readonly string[]): void {
    if (
      this.started &&
      spaces.length === this.spaces.length &&
      spaces.every((one, at) => one === this.spaces[at])
    )
      return
    this.spaces = [...spaces]
    if (this.started) {
      void this.arrive(false)
      return
    }
    this.started = true
    otherWindowWrote((id) => this.heardWritten(id))
    otherWindowDeleted((id) => this.heardDeleted(id))
    this.listing = false
    this.popover = null
    if (!this.open) this.show(this.fresh())
    void this.arrive(true)
  }

  here(space: string): void {
    this.space = space
    const open = this.open
    if (!open || open.turns.length || !space || open.space === space) return
    if (this.running.includes(open.id)) return
    open.space = space
  }

  private async arrive(opening: boolean): Promise<void> {
    const spaces = this.spaces
    for (const space of spaces) await this.adoptOldAsk(space)
    const read = await listEveryThread(spaces).catch(() => this.every)
    if (this.spaces !== spaces) return
    this.every = this.merged(read)
    const heads = this.every
    void this.findParentsOnce(spaces)
    if (!opening) return
    const { last, before } = lastOpen()
    const id =
      heads.find((one) => one.id === last)?.id ??
      heads.find((one) => before.includes(one.id) && !one.archived)?.id
    const open = this.open
    if (id && !open?.turns.length && !(open && this.running.includes(open.id)))
      await this.openThread(id, false)
  }

  private async adoptOldAsk(space: string): Promise<void> {
    const spaces = oldSpaces(stored(OLD_KEY))
    const old = spaces[space]
    const provider = this.providerForNew()
    if (old === undefined || !provider) return
    const thread = threadFromAsk(old, space, provider.id, provider.model)
    if (thread) await keepThread(thread).catch(() => undefined)
    const rest = Object.fromEntries(Object.entries(spaces).filter(([id]) => id !== space))
    if (Object.keys(rest).length) keepJson(OLD_KEY, { spaces: rest })
    else forget(OLD_KEY)
  }

  private async refreshHeads(): Promise<void> {
    const spaces = this.spaces
    const heads = await listEveryThread(spaces).catch(() => this.every)
    if (this.spaces === spaces) this.every = this.merged(heads)
  }

  private relist(): void {
    this.every = this.merged(this.every)
  }

  private words = new WeakMap<Thread, { at: string; words: string }>()

  private wordsIn(thread: Thread): string {
    const at = `${thread.updated}:${thread.turns.length}:${thread.turns.at(-1)?.parts.length ?? 0}`
    const known = this.words.get(thread)
    if (known?.at === at) return known.words
    const words = wordsOf(thread)
    this.words.set(thread, { at, words })
    return words
  }

  private merged(read: readonly Listed[]): Listed[] {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read here, never drawn
    const lines = new Map<string, Listed>()
    for (const one of read) if (!isDeleted(one.id)) lines.set(one.id, one)
    for (const thread of this.live.values()) {
      if (isDeleted(thread.id)) continue
      const listed = thread.turns.length > 0 || this.running.includes(thread.id)
      if (listed && this.spaces.includes(thread.space)) {
        lines.set(thread.id, {
          ...listedHeadOf(thread, this.wordsIn(thread)),
          space: thread.space,
          ...(thread.elsewhere ? { elsewhere: true } : {}),
        })
      } else lines.delete(thread.id)
    }
    return [...lines.values()].sort((a, b) => b.updated - a.updated).map((one) => this.settled(one))
  }

  private settled<T extends Pick<Listed, 'id' | 'state' | 'elsewhere'>>(head: T): T {
    const state = head.state ?? FIRST_STATE
    if (
      this.running.includes(head.id) ||
      head.elsewhere ||
      tasks.of(head.id).length ||
      this.resets[head.id]?.waiting
    )
      return head
    const now = nextState(state, { type: 'relaunch' })
    return now === state ? head : { ...head, state: now }
  }

  private settledRead(thread: Thread | null): Thread | null {
    if (thread) {
      const { state } = this.settled(thread)
      if (state !== undefined) thread.state = state
    }
    return thread
  }

  move(thread: Thread, event: SessionEvent): void {
    const was: SessionState = thread.archived ? 'archived' : (thread.state ?? FIRST_STATE)
    const now = nextState(was, event)
    if (now === was) return
    if (now === 'archived') thread.archived = true
    else {
      delete thread.archived
      thread.state = now
    }
    this.relist()
    if (thread === this.open) this.head = headOf(thread)
    if (thread.turns.length && !this.unclaimed.has(thread.id))
      void keepThread(thread).catch(() => undefined)
  }

  worked(id: string): void {
    const thread = this.threadOf(id)
    if (!thread || this.running.includes(id)) return
    this.move(thread, { type: tasks.of(id).length ? 'wait' : 'idle' })
  }

  async pin(id: string, on = true): Promise<void> {
    const thread = await this.held(id)
    if (!thread) return
    if (on) thread.pinned = Date.now()
    else delete thread.pinned
    this.relist()
    await keepThread(thread).catch(() => undefined)
  }

  private async findParentsOnce(spaces: readonly string[]): Promise<void> {
    let wrote = 0
    for (const space of spaces) {
      const key = `${PARENTS_KEY}:${space}`
      if (!space || stored(key) === true) continue
      try {
        wrote += await findParents(space)
        keepJson(key, true)
      } catch {
        // Tried again next launch.
      }
    }
    if (wrote) await this.refreshHeads()
  }

  private spaceOf(id: string): string {
    return this.live.get(id)?.space ?? this.every.find((one) => one.id === id)?.space ?? this.space
  }

  private fresh(): Thread {
    const provider = this.providerForNew()
    const model = provider ? modelFor(provider) : ''
    const effort = provider ? effortFor(provider.id, model) : 'auto'
    return newThread(
      this.space || (this.spaces[0] ?? ''),
      provider?.id ?? '',
      model,
      effort,
      lastMode(),
    )
  }

  follow(provider: Provider | null): void {
    const thread = this.open
    if (!thread || thread.turns.length || !provider || thread.provider === provider.id) return
    if (this.running.includes(thread.id)) return
    thread.provider = provider.id
    thread.model = modelFor(provider)
    thread.effort = effortFor(provider.id, thread.model)
    thread.usage = noUsage(null)
    this.head = headOf(thread)
    void this.loadModels(provider)
  }

  private show(thread: Thread): void {
    const left = thread !== this.open && this.changing ? this.letGo() : null
    this.open = thread
    this.live.set(thread.id, thread)
    if (left) this.drain(left)
    this.trouble = null
    this.dropped = []
    this.everything = true
    this.redraw()
    if (thread.turns.length) rememberOpen(thread.id)
    const provider = ai.provider(thread.provider)
    if (provider) void this.loadModels(provider)
  }

  private showAgain(fresh: Thread): void {
    const was = new Map(this.turns.map((one) => [one.id, JSON.stringify(one)]))
    for (const turn of fresh.turns) {
      if (was.get(turn.id) !== JSON.stringify(turn)) this.changed.add(turn.id)
    }
    this.open = fresh
    this.redraw()
  }

  async openThread(id: string, focus = true): Promise<void> {
    const held = await this.held(id)
    if (!held) return
    this.listing = false
    agentOpen.id = null
    this.show(held)
    if (focus) this.focus()
  }

  newThread(): void {
    this.listing = false
    this.popover = null
    agentOpen.id = null
    const open = this.open
    if (
      open &&
      !open.turns.length &&
      !this.running.includes(open.id) &&
      !this.queued[open.id]?.length
    ) {
      this.focus()
      return
    }
    this.show(this.fresh())
    rememberOpen(null)
    this.focus()
  }

  ensure(): Thread {
    const open = this.open
    if (open) return open
    const made = this.fresh()
    this.show(made)
    return made
  }

  startHere(
    text: string,
    chips: Mention[],
    around: Around,
  ): { thread: Thread; ended: Promise<Ended> } {
    this.know(workspace.spaces.map((one) => one.id))
    this.here(workspace.activeSpaceId ?? '')
    const thread = this.fresh()
    this.live.set(thread.id, thread)
    return { thread, ended: this.sendIn(thread, text, chips, around) }
  }

  sendIn(thread: Thread, text: string, chips: Mention[], around: Around): Promise<Ended> {
    return new Promise((settle) => {
      this.enqueue(thread, { id: crypto.randomUUID(), text, chips, around, settle })
    })
  }

  watched = $state.raw<{ id: string; turns: readonly Turn[] } | null>(null)
  private watching: Thread | null = null
  private readonly drawWatched = onceAFrame(() => {
    const thread = this.watching
    this.watched = thread ? { id: thread.id, turns: [...thread.turns] } : null
  })

  watch(thread: Thread | null): void {
    this.watching = thread
    this.watched = thread ? { id: thread.id, turns: [...thread.turns] } : null
  }

  adopt(thread: Thread, open = false): void {
    this.live.set(thread.id, thread)
    if (open) {
      this.listing = false
      this.show(thread)
    }
    this.relist()
    void keepThread(thread)
      .catch(() => undefined)
      .then(() => this.refreshHeads())
  }

  startAside(
    space: string,
    title: string,
    mode: Mode,
    text: string,
    without: string[] = [],
  ): Promise<Ended> {
    const thread = { ...this.fresh(), space, title, mode, ...(without.length ? { without } : {}) }
    this.adopt(thread)
    return this.turn(thread, text)
  }

  touched(thread: Thread): void {
    this.live.set(thread.id, thread)
    this.relist()
    if (thread === this.open) {
      this.everything = true
      this.draw()
    }
    if (thread.turns.length) void keepThread(thread).catch(() => undefined)
  }

  answered(thread: Thread): void {
    thread.answered = Date.now()
    this.live.set(thread.id, thread)
    this.relist()
    if (thread.turns.length) void keepThread(thread).catch(() => undefined)
  }

  async saw(id: string): Promise<void> {
    const thread = this.threadOf(id) ?? (await this.held(id))
    if (!thread) return
    const seen = Date.now()
    thread.seen = seen
    this.relist()
    if (thread.turns.length) await keepThread(thread).catch(() => undefined)
  }

  showThreads(query = ''): void {
    if (this.listing && !query) {
      this.listing = false
      this.focus()
      return
    }
    this.popover = null
    this.listing = true
    this.listQuery = query
    void this.refreshHeads()
  }

  listQuery = $state('')

  focus(): void {
    this.focusAsked++
  }

  private redraw(): void {
    const thread = this.open
    if (!thread) {
      this.turns = []
      this.head = null
      return
    }
    this.turns = snapshot(thread.turns, this.turns, this.everything ? 'all' : this.changed)
    this.head = headOf(thread)
    this.changed.clear()
    this.everything = false
  }

  private heard(thread: Thread, event: EngineEvent): void {
    if (event.type === 'turn') {
      this.changed.add(event.turn.id)
      if (event.turn.role === 'you') {
        if (event.turn.steered) this.tookSteered(thread, event.turn.draft?.text ?? '')
        else this.pending = without(this.pending, thread.id)
      } else {
        this.answeringIn(thread, event.turn)
      }
    } else if (event.type === 'part') {
      this.changed.add(event.turn)
      if (event.part.kind === 'tool' && event.part.state === 'asking') {
        this.answered(thread)
        this.move(thread, { type: 'ask' })
      } else if (!stillAsking(thread, event.turn)) this.move(thread, { type: 'answered' })
      this.grew(thread, event.part)
    } else if (event.type === 'done') {
      this.everything = true
    }
    if (thread === this.open) this.draw()
    if (thread === this.watching) this.drawWatched()
  }

  get answeredElsewhere(): boolean {
    return !!this.open?.elsewhere
  }

  private readonly unkept = new Set<Thread>()

  private readonly keepSoon = afterQuiet(() => this.keepAnswers(), KEEP_QUIET, KEEP_AT_MOST)

  private answeringIn(thread: Thread, turn: Turn): void {
    thread.answering = turn.id
    delete thread.elsewhere
    this.beat ??= setInterval(() => this.answersAlive(), ANSWER_BEAT)
    this.unkept.delete(thread)
    const listed = this.every.some((one) => one.id === thread.id)
    const kept = keepThread(thread).catch(() => undefined)
    if (thread === this.open) rememberOpen(thread.id)
    if (!listed) void kept.then(() => this.refreshHeads())
  }

  private readonly writtenThere = new Set<string>()

  private async readAgain(id: string): Promise<void> {
    const held = this.live.get(id)
    if (!held) this.writtenThere.delete(id)
    if (!held || this.running.includes(id)) return
    this.writtenThere.delete(id)
    const fresh = await readThread(held.space, id).catch(() => null)
    if (this.live.get(id) !== held || this.running.includes(id)) return
    if (fresh) {
      this.live.set(id, fresh)
      if (this.open === held) this.showAgain(fresh)
    }
    if (!this.queued[id]?.length) return
    if (fresh && !fresh.elsewhere) this.next(fresh)
    else this.askingAgain ??= setTimeout(() => this.askAgain(), ANSWER_BEAT)
  }

  heardWritten(id: string): void {
    this.writtenThere.add(id)
    void this.readAgain(id)
    this.headsSoon()
  }

  private readonly headsSoon = afterQuiet(() => void this.refreshHeads(), KEEP_QUIET, KEEP_AT_MOST)

  private askingAgain: ReturnType<typeof setTimeout> | null = null

  private askAgain(): void {
    this.askingAgain = null
    for (const id of Object.keys(this.queued)) {
      if (this.live.get(id)?.elsewhere) void this.readAgain(id)
    }
  }

  private beat: ReturnType<typeof setInterval> | null = null

  private answersAlive(): void {
    const answering = this.running.flatMap((id) => {
      const thread = this.live.get(id)
      return thread?.answering ? [thread] : []
    })
    if (answering.length) {
      for (const thread of answering) void keepThread(thread).catch(() => undefined)
      return
    }
    if (this.beat !== null) clearInterval(this.beat)
    this.beat = null
  }

  private grew(thread: Thread, part: Part): void {
    if (part.kind === 'tool' && part.state !== 'running' && part.state !== 'asking') {
      this.unkept.delete(thread)
      void keepThread(thread).catch(() => undefined)
      return
    }
    this.unkept.add(thread)
    this.keepSoon()
  }

  keepAnswers(): void {
    this.keepSoon.cancel()
    for (const thread of this.unkept) writing(keepThread(thread))
    this.unkept.clear()
  }

  submit(around: Around): void {
    const text = this.text.trim()
    const chips = this.chips
    if (!text && !chips.length) return
    const edited = this.editing
    this.chips = []
    this.taken()
    const thread = this.open
    if (edited && thread) {
      void editMessage(thread, edited, text, this)
      return
    }
    this.say(text, chips, around)
  }

  editing = $state<string | null>(null)

  private aside: { text: string; chips: Mention[] } | null = null

  private requeue = $state.raw<{ one: Queued; at: number; thread: Thread } | null>(null)

  private owed = new Set<string>()

  get changing(): boolean {
    return this.editing !== null || this.requeue !== null
  }

  private setAside(): void {
    this.aside ??= { text: this.text, chips: this.chips }
  }

  startEdit(turn?: string): void {
    const thread = this.open
    if (!thread || this.running.includes(thread.id)) return
    const message = turn ? thread.turns.find((one) => one.id === turn) : lastMessage(thread)
    if (!message?.draft) return
    this.putBack(this.requeue, true)
    this.setAside()
    this.editing = message.id
    this.text = message.draft.text
    this.chips = []
    this.focus()
  }

  cancelEdit(): void {
    const thread = this.letGo()
    if (thread) this.drain(thread)
  }

  private letGo(): Thread | null {
    const held = this.requeue
    const thread = held?.thread ?? this.open
    this.taken()
    this.putBack(held, false)
    return thread
  }

  release(): void {
    this.putBack(this.requeue, true)
    this.taken()
  }

  taken(): void {
    this.editing = null
    this.requeue = null
    this.text = this.aside?.text ?? ''
    if (this.aside) this.chips = this.aside.chips
    this.aside = null
  }

  private putBack(held: typeof this.requeue, changed: boolean): void {
    if (!held) return
    if (this.requeue === held) this.requeue = null
    const words = this.text.trim()
    const one =
      changed && (words || this.chips.length)
        ? { ...held.one, text: words, chips: this.chips }
        : held.one
    const { thread } = held
    const list = (this.queued[thread.id] ?? []).slice()
    list.splice(Math.min(held.at, list.length), 0, one)
    this.queued = { ...this.queued, [thread.id]: list }
  }

  private drain(thread: Thread): void {
    if (!this.owed.has(thread.id) || this.running.includes(thread.id)) return
    this.owed.delete(thread.id)
    if (this.live.get(thread.id) !== thread || thread.archived) return
    if (thread !== this.open && !ai.provider(thread.provider)) return
    this.next(thread)
  }

  rewind(turn?: string): void {
    const thread = this.open
    if (thread) openRewind(thread, this, turn)
  }

  send(text: string): void {
    this.say(text, [], this.around?.() ?? { front: null, selection: '' })
  }

  around: (() => Around) | null = null

  private say(text: string, chips: Mention[], around: Around): void {
    const thread = this.open ?? this.fresh()
    if (!this.open) this.show(thread)
    this.enqueue(thread, { id: crypto.randomUUID(), text, chips, around })
  }

  private enqueue(thread: Thread, send: Queued): void {
    this.live.set(thread.id, thread)
    if (this.running.includes(thread.id) || thread.elsewhere) {
      this.queued = { ...this.queued, [thread.id]: [...(this.queued[thread.id] ?? []), send] }
      if (thread.elsewhere) void this.readAgain(thread.id)
      return
    }
    void this.run(thread, send)
  }

  turn(thread: Thread, text: string, once?: Once): Promise<Ended> {
    return this.turnWith(thread, text, [], once)
  }

  turnWith(
    thread: Thread,
    text: string,
    attached: readonly Attached[],
    once?: Once,
  ): Promise<Ended> {
    return new Promise((settle) => {
      this.enqueue(thread, {
        id: crypto.randomUUID(),
        text,
        chips: attached.map((one) => ({
          kind: 'words' as const,
          id: one.label,
          label: one.label,
          text: one.text,
        })),
        around: { front: null, selection: '' },
        ...(once ? { once } : {}),
        settle,
      })
    })
  }

  private async run(thread: Thread, send: Queued): Promise<void> {
    const { text, chips, around, once } = send
    const provider = ai.provider(thread.provider)
    if (!provider) {
      const words = t('Add an AI provider in Settings first.')
      if (thread === this.open) {
        this.trouble = words
        if (!send.settle) this.giveBack(text)
      }
      send.settle?.({ stop: 'error', error: words, turn: null, usage: null })
      return
    }
    if (thread === this.open) this.trouble = null
    const stopper = this.begin(thread, text)
    if (!(await this.claimed(thread))) {
      this.yielded(thread, send)
      return
    }
    const stop = () => stopper.abort()
    once?.signal?.addEventListener('abort', stop)
    const before = { mode: thread.mode, model: thread.model, effort: thread.effort }
    if (once) thread.own = before
    Object.assign(thread, {
      ...(once?.mode ? { mode: once.mode } : {}),
      ...(once?.model ? { model: once.model } : {}),
      ...(once?.effort ? { effort: once.effort } : {}),
    })
    let ended: Ended = { stop: 'error', turn: null, usage: null }
    try {
      const draft: Draft = await draftOf(
        text,
        chips,
        thread.mode,
        around.front,
        around.selection,
        spaceOfThread(thread),
        around.picked ?? null,
      )
      ended = await this.sendDraft(thread, provider, draft, stopper)
      if (readOutside(thread.turns)) ended = { ...ended, outside: true }
    } catch (error) {
      const words = message(error, t('The model did not answer.'))
      ended = { stop: 'error', error: words, turn: null, usage: null }
      if (thread === this.open) {
        this.trouble = words
        if (!send.settle) this.giveBack(text)
      }
    } finally {
      once?.signal?.removeEventListener('abort', stop)
      if (once) Object.assign(thread, before)
      if (once) delete thread.own
      await this.finish(
        thread,
        !stopper.signal.aborted,
        stopper.signal.aborted ? 'stopped' : ended.stop,
      )
    }
    send.settle?.(ended)
    if (!stopper.signal.aborted) this.next(thread)
  }

  private giveBack(text: string): void {
    const now = this.text.trim()
    if (now === text.trim()) return
    this.text = now ? `${text}\n\n${this.text}` : text
  }

  private readonly unclaimed = new Set<string>()

  private async claimed(thread: Thread): Promise<boolean> {
    const { id } = thread
    await this.closing.get(id)?.catch(() => undefined)
    const won = await claimAnswer(id)
    this.unclaimed.delete(id)
    if (won && !this.writtenThere.has(id)) {
      if (thread.turns.length) void keepThread(thread).catch(() => undefined)
      return true
    }
    if (won) unclaimAnswer(id)
    else {
      thread.elsewhere = true
      this.awaitFreed(id)
    }
    return false
  }

  private readonly awaiting = new Set<string>()

  private awaitFreed(id: string): void {
    if (this.awaiting.has(id)) return
    this.awaiting.add(id)
    void answerFreed(id).then(() => {
      this.awaiting.delete(id)
      void this.readAgain(id)
    })
  }

  private yielded(thread: Thread, send?: Queued): void {
    const { id } = thread
    this.stoppers.delete(id)
    this.running = this.running.filter((one) => one !== id)
    this.pending = without(this.pending, id)
    this.following.delete(id)
    if (send) this.queued = { ...this.queued, [id]: [send, ...(this.queued[id] ?? [])] }
    this.relist()
    if (thread === this.open) this.redraw()
    if (!thread.elsewhere) void this.readAgain(id)
  }

  private begin(thread: Thread, text?: string): AbortController {
    const stopper = new AbortController()
    this.unclaimed.add(thread.id)
    this.unwait(thread.id)
    this.owed.delete(thread.id)
    this.stoppers.set(thread.id, stopper)
    if (!thread.turns.length && thread.provider === this.providerForNew()?.id)
      this.following.add(thread.id)
    this.running = [...this.running, thread.id]
    if (text !== undefined) this.pending = { ...this.pending, [thread.id]: text }
    this.live.set(thread.id, thread)
    this.relist()
    this.move(thread, { type: 'start' })
    return stopper
  }

  private readonly closing = new Map<string, Promise<void>>()

  private finish(thread: Thread, replied = false, stop: Stop = 'end'): Promise<void> {
    const { id } = thread
    const done: Promise<void> = this.finished(thread, replied, stop).finally(() => {
      unclaimAnswer(id)
      if (this.closing.get(id) === done) this.closing.delete(id)
    })
    this.closing.set(id, done)
    return done
  }

  private async finished(thread: Thread, replied: boolean, stop: Stop): Promise<void> {
    if (replied && thread.turns.at(-1)?.role === 'model') thread.answered = Date.now()
    delete thread.answering
    this.unkept.delete(thread)
    this.stoppers.delete(thread.id)
    this.running = this.running.filter((one) => one !== thread.id)
    this.relist()
    this.move(thread, { type: 'end', stop, busy: tasks.of(thread.id).length > 0 })
    this.pending = without(this.pending, thread.id)
    const untaken = this.steering[thread.id] ?? []
    this.steering = without(this.steering, thread.id)
    this.queueFirst(thread, untaken)
    const followed = this.following.delete(thread.id)
    this.everything = true
    if (thread === this.open) this.redraw()
    if (thread === this.watching) this.drawWatched()
    if (!thread.turns.length) {
      if (thread === this.open) {
        this.here(this.space)
        if (followed) this.follow(this.providerForNew())
      }
      return
    }
    await keepThread(thread).catch(() => undefined)
    unclaimAnswer(thread.id)
    if (thread === this.open) rememberOpen(thread.id)
    await this.refreshHeads()
  }

  private async ended(
    thread: Thread,
    stopper: AbortController,
    replied = false,
    stop: Stop = 'end',
  ): Promise<void> {
    await this.finish(
      thread,
      replied && !stopper.signal.aborted,
      stopper.signal.aborted ? 'stopped' : stop,
    )
    if (!stopper.signal.aborted) this.next(thread)
  }

  private async sendDraft(
    thread: Thread,
    provider: Provider,
    draft: Draft,
    stopper: AbortController,
  ): Promise<Ended> {
    if (isDeleted(thread.id) && (await staysDeleted(thread.id)))
      return { stop: 'stopped', turn: null, usage: null }
    const engine = await engineOf(provider.kind)
    const ended: Ended = { stop: 'end', turn: null, usage: null }
    await engine.send(
      thread,
      draft,
      (event) => {
        if (event.type === 'turn' && event.turn.role === 'model') ended.turn = event.turn
        else if (event.type === 'usage')
          ended.usage = ended.usage ? added(ended.usage, event.usage) : event.usage
        else if (event.type === 'limit') ended.limit = event.limit
        else if (event.type === 'done') {
          ended.stop = event.stop
          if (event.error !== undefined) ended.error = event.error
        }
        this.heard(thread, event)
      },
      stopper.signal,
    )
    if (ended.turn) ended.turn.took = Date.now() - ended.turn.at
    if (ended.stop === 'error' && ended.limit?.state === 'reached' && ended.limit.until !== null)
      this.resets = { ...this.resets, [thread.id]: { until: ended.limit.until, waiting: false } }
    if (ended.stop === 'error' && !ended.turn && ended.error) throw new Error(ended.error)
    return ended
  }

  private next(thread: Thread): void {
    const [first, ...rest] = this.queued[thread.id] ?? []
    if (!first) {
      if (this.requeue?.thread === thread) this.owed.add(thread.id)
      return
    }
    this.queued = { ...this.queued, [thread.id]: rest }
    void this.run(thread, first)
  }

  steer(): void {
    const thread = this.open
    const text = this.text.trim()
    if (!text || !thread || !this.running.includes(thread.id)) return
    this.taken()
    this.steerWords(thread, text)
  }

  private steerWords(thread: Thread, text: string): void {
    const provider = ai.provider(thread.provider)
    if (!provider) return
    this.steering = { ...this.steering, [thread.id]: [...(this.steering[thread.id] ?? []), text] }
    void engineOf(provider.kind)
      .then((engine) => engine.steer(thread, text))
      .catch(() => false)
      .then((took) => {
        if (!took && this.tookSteered(thread, text)) this.queueFirst(thread, [text])
      })
  }

  private tookSteered(thread: Thread, text: string): boolean {
    const list = this.steering[thread.id] ?? []
    const at = list.indexOf(text)
    if (at < 0) return false
    const left = list.slice()
    left.splice(at, 1)
    this.steering = { ...this.steering, [thread.id]: left }
    return true
  }

  private queueFirst(thread: Thread, texts: readonly string[]): void {
    if (!texts.length || isDeleted(thread.id)) return
    const sends: Queued[] = texts.map((text) => ({
      id: crypto.randomUUID(),
      text,
      chips: [],
      around: { front: null, selection: '' },
    }))
    this.queued = { ...this.queued, [thread.id]: [...sends, ...(this.queued[thread.id] ?? [])] }
  }

  stop(): void {
    const id = this.open?.id
    if (id) this.stopIn(id)
  }

  stopIn(id: string): void {
    this.stoppers.get(id)?.abort()
    void import('../helpers/helpers.svelte').then(({ helpers }) => {
      helpers.stopUnder(id)
    })
  }

  get busy(): boolean {
    return !!this.head && this.running.includes(this.head.id)
  }

  private setQueue(list: Queued[]): void {
    const id = this.open?.id
    if (id) this.queued = { ...this.queued, [id]: list }
  }

  get queue(): Queued[] {
    const id = this.head?.id
    return id ? (this.queued[id] ?? []) : []
  }

  unqueue(id: string): void {
    this.queue.find((one) => one.id === id)?.settle?.({ stop: 'stopped', turn: null, usage: null })
    this.setQueue(this.queue.filter((one) => one.id !== id))
  }

  editQueued(id: string): void {
    const thread = this.open
    if (!thread || !this.queue.some((each) => each.id === id)) return
    this.putBack(this.requeue, true)
    this.editing = null
    const at = this.queue.findIndex((each) => each.id === id)
    const one = this.queue[at]
    if (!one) return
    this.unqueue(id)
    this.setAside()
    const back: Queued = { ...one }
    delete back.settle
    this.requeue = { one: back, at, thread }
    this.text = one.text
    this.chips = one.chips
    this.focus()
  }

  steerQueued(id: string): void {
    const one = this.queue.find((each) => each.id === id)
    const thread = this.open
    if (!one || !thread) return
    if (!this.running.includes(thread.id)) {
      this.setQueue(this.queue.filter((each) => each.id !== id))
      void this.run(thread, one)
      return
    }
    this.unqueue(id)
    this.steerWords(thread, one.text)
  }

  moveQueued(from: number, to: number): void {
    const list = this.queue.slice()
    const [moved] = list.splice(from, 1)
    if (!moved) return
    list.splice(Math.max(0, Math.min(to, list.length)), 0, moved)
    this.setQueue(list)
  }

  retry(model?: { provider: string; id: string }, thread = this.open): void {
    if (!thread || this.running.includes(thread.id) || thread.elsewhere) return
    if (model) {
      void this.chooseModel(model.provider, model.id).then((switched) => {
        if (switched) this.retry(undefined, thread)
      })
      return
    }
    let at = thread.turns.length - 1
    while (at >= 0 && (thread.turns[at]?.role !== 'you' || thread.turns[at]?.steered)) at--
    const asked = thread.turns[at]
    const draft = asked?.draft
    if (!draft) return
    const provider = ai.provider(thread.provider)
    if (!provider) {
      if (thread === this.open) this.trouble = t('Add an AI provider in Settings first.')
      return
    }
    const taken = thread.turns.splice(at)
    this.everything = true
    this.redraw()
    const stopper = this.begin(thread, draft.text)
    void this.claimed(thread).then((won) => {
      if (won) {
        this.retried(thread, provider, draft, stopper, taken)
        return
      }
      thread.turns.push(...taken)
      this.yielded(thread)
    })
  }

  private retried(
    thread: Thread,
    provider: Provider,
    draft: Draft,
    stopper: AbortController,
    taken: Turn[],
  ): void {
    const at = thread.turns.length
    let stop: Stop = 'end'
    void this.sendDraft(thread, provider, draft, stopper)
      .then((ended) => (stop = ended.stop))
      .catch((error: unknown) => {
        stop = 'error'
        if (thread.turns.length === at) thread.turns.push(...taken)
        if (thread === this.open) this.trouble = message(error, t('The model did not answer.'))
      })
      .finally(() => void this.ended(thread, stopper, true, stop))
  }

  waitForReset(on: boolean): void {
    const thread = this.open
    const reset = thread && this.resets[thread.id]
    if (!thread || !reset) return
    clearTimeout(this.timers.get(thread.id))
    this.resets = { ...this.resets, [thread.id]: { until: reset.until, waiting: on } }
    this.move(thread, on ? { type: 'wait' } : { type: 'end', stop: 'error', busy: false })
    if (!on) return
    const after = reset.until + AFTER_RESET - Date.now()
    this.timers.set(
      thread.id,
      setTimeout(() => this.retry(undefined, thread), after),
    )
  }

  private unwait(id: string): void {
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    this.resets = without(this.resets, id)
  }

  setMode(mode: Mode): void {
    const thread = this.open
    rememberMode(mode)
    if (!thread) return
    thread.mode = mode
    this.changedHead(thread)
  }

  nextMode(): void {
    this.setMode(nextMode(this.open?.mode ?? lastMode()))
  }

  async loadModels(provider: Provider): Promise<ModelInfo[]> {
    const held = this.models[provider.id]
    if (held) return held
    let asked = this.asking.get(provider.id)
    if (!asked) {
      asked = engineOf(provider.kind)
        .then((engine) => engine.models(provider))
        .catch(() => [])
      this.asking.set(provider.id, asked)
    }
    const list = await asked
    if (list.length) this.models = { ...this.models, [provider.id]: list }
    else this.asking.delete(provider.id)
    return list
  }

  async chooseModel(provider: string, model: string): Promise<boolean> {
    const thread = this.open
    if (!thread) return false
    const info = this.models[provider]?.find((one) => one.id === model)
    const cost = switchCost(
      thread.usage,
      thread,
      { provider, model, window: info?.window ?? null },
      thread.autocompact,
    )
    if (cost && storedText(SWITCH_KEY) !== 'never') {
      const name = info?.name ?? model
      const detail = [
        t('The next message sends the whole conversation again: about {count} more tokens.', {
          count: tokens(cost.tokens, i18n.language),
        }),
        ...(cost.compacts ? [t('It is too long for this model, so it is compacted first.')] : []),
      ].join(' ')
      const answer = await prompt.chooseTicking({
        title: t('Switch to {model}?', { model: name }),
        detail,
        options: [
          { id: 'switch', label: t('Switch'), primary: true },
          { id: 'cancel', label: t('Cancel'), lands: true },
        ],
        tick: t("Don't ask again"),
      })
      if (answer?.id !== 'switch') return false
      if (answer.ticked) keep(SWITCH_KEY, 'never')
    }
    if (cost?.compacts && this.open === thread) await this.compacted()
    if (this.open !== thread) return false
    this.switchModel(provider, model)
    return true
  }

  private switchModel(provider: string, model: string): void {
    const thread = this.open
    if (!thread) return
    const changed = thread.provider !== provider
    thread.provider = provider
    thread.model = model
    rememberModel(provider, model)
    const info = this.models[provider]?.find((one) => one.id === model)
    thread.effort = within(effortFor(provider, model), info?.efforts ?? ['auto'])
    if (changed) thread.usage = noUsage(info?.window ?? null)
    else if (info) thread.usage = { ...thread.usage, window: info.window ?? thread.usage.window }
    if (!info?.fast) delete thread.fast
    this.changedHead(thread)
    const listed = ai.provider(provider)
    if (listed) void this.loadModels(listed)
  }

  modelNamed(name: string): boolean {
    const provider = this.provider
    const list = provider ? (this.models[provider.id] ?? []) : []
    const want = name.toLowerCase()
    const found =
      list.find((one) => one.id.toLowerCase() === want || one.name.toLowerCase() === want) ??
      list.find(
        (one) => one.id.toLowerCase().includes(want) || one.name.toLowerCase().includes(want),
      )
    if (!found || !provider) return false
    void this.chooseModel(provider.id, found.id)
    return true
  }

  setEffort(effort: Effort | 'next'): void {
    const thread = this.open
    const model = this.model
    if (!thread || !model) return
    const level =
      effort === 'next' ? nextEffort(thread.effort, model.efforts) : within(effort, model.efforts)
    thread.effort = level
    rememberEffort(thread.provider, thread.model, level)
    this.changedHead(thread)
  }

  setFast(on?: boolean): void {
    const thread = this.open
    if (!thread || !this.model?.fast) return
    if (on ?? !thread.fast) thread.fast = true
    else delete thread.fast
    this.changedHead(thread)
  }

  private changedHead(thread: Thread): void {
    if (thread === this.open) this.head = headOf(thread)
    this.relist()
    if (thread.turns.length) void keepThread(thread).catch(() => undefined)
  }

  compact(focus?: string): void {
    void this.compacted(focus)
  }

  private async compacted(focus?: string): Promise<void> {
    const thread = this.open
    const provider = this.provider
    if (!thread?.turns.length || !provider || this.running.includes(thread.id)) return
    const stopper = this.begin(thread)
    let stop: Stop = 'end'
    if (!(await this.claimed(thread))) {
      this.yielded(thread)
      return
    }
    return engineOf(provider.kind)
      .then((engine) => engine.compact(thread, focus))
      .catch((error: unknown) => {
        stop = 'error'
        this.trouble = message(error, t('The model did not answer.'))
      })
      .then(() => this.ended(thread, stopper, false, stop))
  }

  openContext(): void {
    this.popover = 'context'
  }

  openModels(): void {
    this.popover = 'model'
  }

  toggleFolded(): void {
    this.unfolded = !this.unfolded
  }

  drop(key: string): void {
    if (!this.dropped.includes(key)) this.dropped = [...this.dropped, key]
  }

  async rename(name?: string, id = this.open?.id): Promise<void> {
    const thread = id ? await this.held(id) : null
    if (!thread) return
    const named = name ?? (await prompt.ask({ title: t('Rename'), value: thread.title }))
    if (!named?.trim()) return
    thread.title = named.trim()
    this.changedHead(thread)
    void this.refreshHeads()
  }

  branch(name?: string, from?: string): void {
    const thread = this.open
    const last = from ? thread?.turns.find((one) => one.id === from) : thread?.turns.at(-1)
    if (!thread || !last) return
    const copy = branchThread(thread, last.id, name ?? thread.title)
    this.show(copy)
    this.relist()
    rememberOpen(copy.id)
    void keepThread(copy).then(() => this.refreshHeads())
    this.focus()
  }

  continueFrom(turns: readonly { role: 'you' | 'model'; text: string }[], space: string): void {
    const provider = this.providerForNew()
    const thread = threadFromAsk(turns, space, provider?.id ?? '', provider?.model ?? '')
    if (!thread) return
    thread.mode = lastMode()
    this.adopt(thread, true)
    rememberOpen(thread.id)
    this.focus()
  }

  voice(on?: boolean): void {
    void import('./dictate.svelte').then(({ dictation }) => dictation.toggle(on))
  }

  private async held(id: string): Promise<Thread | null> {
    const live = this.live.get(id)
    if (live) return live
    const read = this.settledRead(await readThread(this.spaceOf(id), id).catch(() => null))
    if (read && !isDeleted(id)) {
      const now = this.live.get(id)
      if (now) return now
      this.live.set(id, read)
    }
    return read
  }

  async exportThread(): Promise<void> {
    const thread = this.open
    if (!thread?.turns.length) return
    await this.noteFrom(threadMarkdown(thread, t('Untitled')))
  }

  async noteFrom(text: string): Promise<void> {
    const thread = this.open
    if (!thread) return
    const root = workspace.spaces.find((one) => one.id === thread.space)?.root
    const path = root ? await workspace.noteFrom(text, root) : null
    if (path) {
      await workspace.open(path)
      return
    }
    const why = root ? t('you can only read this space') : t('no such space')
    const { hostOf } = await import('../commands/host')
    hostOf(this).line(thread, `${t('Save as a note')} · ${why}`)
  }

  archive(id = this.open?.id): void {
    void this.setArchived(id, true)
  }

  unarchive(id: string): void {
    void this.setArchived(id, false)
  }

  private async setArchived(id: string | undefined, archived: boolean): Promise<void> {
    if (!id) return
    const thread = await this.held(id)
    if (!thread) return
    this.move(thread, { type: archived ? 'archive' : 'unarchive' })
    await keepThread(thread).catch(() => undefined)
    if (archived) this.forgetEdit(thread.id, true)
    if (archived && thread === this.open) this.newThread()
    await this.refreshHeads()
  }

  private forgetEdit(id: string, kept = false): void {
    this.owed.delete(id)
    const held = this.requeue
    if (held?.thread.id !== id) return
    this.taken()
    if (kept) this.putBack(held, false)
  }

  async remove(id = this.open?.id): Promise<void> {
    if (!id) return
    const sure = await prompt.confirm({
      title: t('Delete this chat?'),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!sure) return
    const deleting = deleteThread(this.spaceOf(id), id).then(
      () => true,
      () => false,
    )
    this.relist()
    this.stopAll(id)
    if (!(await deleting)) {
      this.relist()
      await this.refreshHeads()
      return
    }
    this.forgetThread(id)
    await this.refreshHeads()
  }

  heardDeleted(id: string): void {
    this.stopAll(id)
    this.forgetThread(id)
    this.relist()
  }

  private stopAll(id: string): void {
    this.stoppers.get(id)?.abort()
    this.unwait(id)
    this.forgetEdit(id)
    for (const one of this.queued[id] ?? [])
      one.settle?.({ stop: 'stopped', turn: null, usage: null })
    this.queued = without(this.queued, id)
  }

  private forgetThread(id: string): void {
    void import('../helpers/helpers.svelte').then(({ helpers }) => {
      helpers.stopUnder(id)
      helpers.forget(id)
    })
    this.live.delete(id)
    if (this.open?.id === id) this.newThread()
  }
}

export const chat = new Chat()

owes(() => chat.keepAnswers())

tasks.watch((id) => chat.worked(id))

panelKeepsUnread()
$effect.root(() => {
  $effect(() => {
    chatsUnread.any = chat.unread.size > 0
  })

  $effect(() => {
    const space = workspace.activeSpaceId ?? ''
    untrack(() => chat.here(space))
  })
  $effect(() => {
    const spaces = workspace.spaces.map((one) => one.id)
    untrack(() => chat.know(spaces))
  })

  $effect(() => {
    const provider = ai.providerFor('ask')
    untrack(() => chat.follow(provider))
  })
})

answerThreadSpaces(
  (id) => chat.threadOf(id)?.space ?? chat.every.find((one) => one.id === id)?.space ?? null,
)

function stillAsking(thread: Thread, turn: string): boolean {
  const parts = thread.turns.find((one) => one.id === turn)?.parts ?? []
  return parts.some((part) => part.kind === 'tool' && part.state === 'asking')
}

function spaceOfThread(thread: Thread): { id: string; root: string } | null {
  return workspace.spaces.find((one) => one.id === thread.space) ?? workspace.activeSpace ?? null
}
