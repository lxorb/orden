/** The AI panel's state: the threads, the one open, the ones running, what is
 *  queued behind them, and everything the controls under the field change
 *  (docs/ai-sidebar.md 4).
 *
 *  The engine writes into a thread in place and says so through its events
 *  (chat/engine.ts); this store keeps the threads as the plain objects the engine
 *  writes into and hands the panel a copy of the open one, made at most once a frame
 *  (snapshot.ts). A thread keeps running when another is opened or the space changes,
 *  and lands in the space it was asked in.
 *
 *  The threads are one list, every space's (#332, Emil: "They should stay the same across
 *  spaces: one list of chats, and the open chat stays open when the space changes"). A
 *  thread is still kept in, and works in, the space it was started in - its notes, its
 *  AGENTS.md, its files - so a space changing moves no thread and changes no answer on
 *  its way; it only says where the next new chat starts.
 *
 *  Fetched with the panel, never in the first paint; see surfaces.svelte.ts. */

import { untrack } from 'svelte'
import { answerThreadSpaces } from '../../automation/caller'
import { i18n, message, t } from '../../i18n.svelte'
import { prompt } from '../../prompt.svelte'
import { without } from '../../records'
import { forget, keep, keepJson, stored, storedText } from '../../stored'
import { onceAFrame } from '../../timing'
import { workspace } from '../../workspace.svelte'
import { unlisted } from '../chat/catalogue'
import { nextEffort, within } from '../chat/effort'
import {
  branchThread,
  chatsOf,
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
  readThread,
} from '../chat/threads'
import type {
  Draft,
  Effort,
  EngineEvent,
  Goal,
  Mode,
  ModelInfo,
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

/** How long after a plan resets a message waiting for it goes again: the window ends by
 *  the provider's clock, not this one. */
const AFTER_RESET = 30_000

/** A message waiting behind a running turn. */
export interface Queued {
  id: string
  text: string
  chips: Mention[]
  /** What was around the field when it was pressed. */
  around: Around
  /** A command's send: its own mode, model, effort and stop. */
  once?: Once
  /** A command waiting on how it ends. */
  settle?: (ended: Ended) => void
}

/** What the controls under the field show of the open thread. */
export interface Head {
  id: string
  title: string
  /** The thread it is a helper of, which its conversation goes back to. */
  parent: string | null
  provider: string
  model: string
  effort: Effort
  mode: Mode
  fast: boolean
  usage: Usage
  archived: boolean
  /** Its goal (lane 5's `/goal`), copied so the chip redraws as it moves. */
  goal: Goal | null
  /** Whether it has been sent anything, and so is kept. */
  kept: boolean
}

/** The two places the panel is drawn: the right side, and a tab of its own. */
export type Host = 'side' | 'tab'

/** What the panel needs from around it at the moment of sending: the note in front and
 *  its selection, where their chips are on. */
export interface Around {
  front: Front | null
  selection: string
  /** The document the selection is in, which says whose words it may be. */
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

/** "Don't ask again" under a switch of model that sends the conversation again (#1089). */
const SWITCH_KEY = 'nib:ai-switch-asks'

/** Where a space's helpers were told their parents, once (`findParentsOnce`). */
const PARENTS_KEY = 'nib:ai-helpers-parented'

class Chat implements Panel {
  /** Every space's threads, newest first, each with the space it is kept in: helpers
   *  too, which the lists leave out. */
  every = $state.raw<Listed[]>([])
  /** The chats, as every list of them shows them (#1062): `every` without the helpers,
   *  which are their parents' steps. */
  heads = $derived(chatsOf(this.every))
  /** The chats with an answer the reader has not seen yet, helpers' counted in their
   *  chat's (#1064). */
  unread = $derived(unreadOf(this.every))
  /** Where each chat stands (#1089), a helper's question counted as its chat's. */
  states = $derived(statesOf(this.every))
  /** The open thread, as the controls show it. */
  head = $state.raw<Head | null>(null)
  /** Its turns, as the conversation draws them. */
  turns = $state.raw<Turn[]>([])
  /** Threads with a turn on its way, by id. */
  running = $state.raw<readonly string[]>([])
  /** A message pressed and not yet a turn of its thread, drawn at once. */
  pending = $state.raw<Record<string, string>>({})
  queued = $state.raw<Record<string, Queued[]>>({})
  /** Words sent into a running turn, until it takes them. */
  steering = $state.raw<Record<string, string[]>>({})
  /** What went wrong before any turn could say it: no provider, no engine. */
  trouble = $state<string | null>(null)
  /** When each thread's plan resets, where its last send ended at the plan's limit, and
   *  whether its last message goes again then. */
  resets = $state.raw<Record<string, { until: number; waiting: boolean }>>({})

  /** The field, and the chips added to it by hand. */
  text = $state('')
  chips = $state.raw<Mention[]>([])
  /** Chips the panel offers on its own that were taken off for this thread. */
  dropped = $state.raw<readonly string[]>([])

  /** The thread list instead of the conversation. */
  listing = $state(false)
  /** Which popover is up. */
  popover = $state<'model' | 'context' | null>(null)
  /** Every thinking and tool row open (Ctrl+O). */
  unfolded = $state(false)
  /** Each provider's models, once asked. */
  models = $state.raw<Record<string, ModelInfo[]>>({})
  /** Asks the field to take the keyboard; the panel answers it. */
  focusAsked = $state(0)
  /** Where the panel was last used, the right side or a tab of its own ("Open in new
   *  tab"): the one place the keyboard and a popover go while both are on screen. */
  host = $state<Host>('side')

  /** The spaces whose threads the list holds, and the one in front, where a new thread
   *  starts. Plain, so the effects that set them never read what they write. */
  private spaces: readonly string[] = []
  private space = ''
  private started = false
  /** Every thread this run has had in hand, by id, as the engine writes into them. */
  private live = new Map<string, Thread>()
  private open: Thread | null = null
  private stoppers = new Map<string, AbortController>()
  /** Fresh threads sent in while on the provider Ask uses, which they follow again
   *  should the send come to nothing. */
  private following = new Set<string>()
  /** One timer a thread waiting for its plan to reset. */
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Which turns changed since the last frame drew the open thread. */
  private changed = new Set<string>()
  private everything = false
  private readonly draw = onceAFrame(() => this.redraw())
  private asking = new Map<string, Promise<ModelInfo[]>>()

  /** The thread open, raw: what an action changes. */
  get thread(): Thread | null {
    return this.open
  }

  /** The folder of the space the open thread works in, which its sources and its
   *  changes are paths in: a thread stays in the space it was started in when the
   *  reader moves to another. The space in front where it names none this device has. */
  get root(): string | null {
    return this.open
      ? (spaceOfThread(this.open)?.root ?? null)
      : (workspace.activeSpace?.root ?? null)
  }

  /** A thread this run has held, by id: what a helper is started under. */
  threadOf(id: string): Thread | null {
    return this.live.get(id) ?? (this.open?.id === id ? this.open : null)
  }

  /** The provider a new thread asks: Settings > AI > Used for > Ask's. */
  private providerForNew(): Provider | null {
    return ai.providerFor('ask')
  }

  /** The provider of the open thread, or the one a new thread would ask. */
  get provider(): Provider | null {
    const id = this.head?.provider
    return (id ? ai.provider(id) : null) ?? this.providerForNew()
  }

  /** The open thread's model as its provider lists it. */
  get model(): ModelInfo | null {
    const head = this.head
    const provider = this.provider
    if (!head || !provider) return null
    return (
      this.models[provider.id]?.find((one) => one.id === head.model) ??
      unlisted(provider, head.model)
    )
  }

  // ── Spaces and threads ────────────────────────────────

  /** The spaces there are, whose threads are the list: the first time, the thread open
   *  last, else a new one, as the panel was left (#428); afterwards only the list again, as a space
   *  comes or goes. Called from an effect, so it decides from what it is handed and from
   *  plain fields only. */
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
    this.listing = false
    this.popover = null
    // A quick question carried on before the panel was ever drawn is already open.
    if (!this.open) this.show(this.fresh())
    void this.arrive(true)
  }

  /** The space in front, which is where the next new thread starts. The open thread
   *  stays open whatever it is; one nothing has been sent in yet is not anybody's, so it
   *  moves to the space in front with the reader. A first message on its way (gathered,
   *  or asked, before its turn is in the thread) was sent in its space, which stays. */
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
    // A first message on its way (the panel's, or a quick question's) is a chat in front.
    const open = this.open
    if (id && !open?.turns.length && !(open && this.running.includes(open.id)))
      await this.openThread(id, false)
  }

  /** The Ask panel's conversation for this space, made a thread once. */
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

  /** The list drawn again from the threads in hand, at once (#1111): a chat made,
   *  renamed, archived, pinned or deleted is there as it is now, never only once its
   *  file is written and read back. */
  private relist(): void {
    this.every = this.merged(this.every)
  }

  /** A thread's words for the list's search, worked out again only once it has changed:
   *  the list is drawn again from every thread in hand, and a long one has many. */
  private words = new WeakMap<Thread, { at: string; words: string }>()

  private wordsIn(thread: Thread): string {
    const at = `${thread.updated}:${thread.turns.length}:${thread.turns.at(-1)?.parts.length ?? 0}`
    const known = this.words.get(thread)
    if (known?.at === at) return known.words
    const words = wordsOf(thread)
    this.words.set(thread, { at, words })
    return words
  }

  /** What is read of the list, under the threads this run holds (#1111): a thread in hand
   *  is newer than its file, which may still be on its way or read before the change, so
   *  its line is the thread's own; a thread deleted is in no list, whatever was read. A
   *  thread is listed once it has been sent something, its first message on its way too
   *  (`begin`), as the file has it once it is written. */
  private merged(read: readonly Listed[]): Listed[] {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read here, never drawn
    const lines = new Map<string, Listed>()
    for (const one of read) if (!isDeleted(one.id)) lines.set(one.id, one)
    for (const thread of this.live.values()) {
      if (isDeleted(thread.id)) continue
      const listed = thread.turns.length > 0 || this.running.includes(thread.id)
      if (listed && this.spaces.includes(thread.space)) {
        lines.set(thread.id, { ...listedHeadOf(thread, this.wordsIn(thread)), space: thread.space })
      } else lines.delete(thread.id)
    }
    return [...lines.values()].sort((a, b) => b.updated - a.updated).map((one) => this.settled(one))
  }

  /** A head as this run knows it: a chat written down as at work that nothing in this
   *  run is working on was at work when the app last closed, and is interrupted
   *  (`relaunch`). Written down the next time the thread itself is. */
  private settled<T extends Listed>(head: T): T {
    const state = head.state ?? FIRST_STATE
    if (this.running.includes(head.id) || tasks.of(head.id).length || this.resets[head.id]?.waiting)
      return head
    const now = nextState(state, { type: 'relaunch' })
    return now === state ? head : { ...head, state: now }
  }

  /** The one door every change of a chat's state goes through (#1089): the machine in
   *  session-state.ts says where it moves, and the list and the file are told. A send,
   *  a question, an answer's end, work left running out of sight, an archive - each of
   *  them is a call here and nowhere else. */
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
    if (thread.turns.length) void keepThread(thread).catch(() => undefined)
  }

  /** Work out of sight started or ended for a thread (`tasks`): waiting while there is
   *  any and no turn is running, done once the last of it is over. */
  worked(id: string): void {
    const thread = this.threadOf(id)
    if (!thread || this.running.includes(id)) return
    this.move(thread, { type: tasks.of(id).length ? 'wait' : 'idle' })
  }

  /** The thread a chat's pin is on, pinned to the top of every list or taken off it. */
  async pin(id: string, on = true): Promise<void> {
    const thread = await this.held(id)
    if (!thread) return
    if (on) thread.pinned = Date.now()
    else delete thread.pinned
    this.relist()
    await keepThread(thread).catch(() => undefined)
  }

  /** Each space's helpers kept before a helper said whose it was (#1062) told so once,
   *  in the background, and the lists drawn again without them. */
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

  /** The space a thread is kept in: its line's, else the space in front. */
  private spaceOf(id: string): string {
    return this.live.get(id)?.space ?? this.every.find((one) => one.id === id)?.space ?? this.space
  }

  /** A new thread on the provider Used for > Ask names, in the last mode picked. Not
   *  written down until something is sent in it. */
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

  /** A thread nothing has been sent in follows Settings > AI > Used for > Ask, so a
   *  provider set up or changed while the panel is open is the one it asks. Called from
   *  an effect with the provider, so it reads only the plain thread. A first message on
   *  its way is asked of the provider it was sent to. */
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
    // An edit is the open thread's: another thread in front lets it go, and the field
    // gets back what it held, so Enter there never sends one thread's change in another.
    const left = thread !== this.open && this.changing ? this.letGo() : null
    this.open = thread
    this.live.set(thread.id, thread)
    // Its queue goes on once the other thread is in front, so nothing of it lands here.
    if (left) this.drain(left)
    this.trouble = null
    this.dropped = []
    this.everything = true
    this.redraw()
    if (thread.turns.length) rememberOpen(thread.id)
    const provider = ai.provider(thread.provider)
    if (provider) void this.loadModels(provider)
  }

  async openThread(id: string, focus = true): Promise<void> {
    const held = await this.held(id)
    if (!held) return
    this.listing = false
    this.show(held)
    if (focus) this.focus()
  }

  newThread(): void {
    this.listing = false
    this.popover = null
    if (this.open && !this.open.turns.length) {
      this.focus()
      return
    }
    this.show(this.fresh())
    rememberOpen(null)
    this.focus()
  }

  /** The open thread, shown first where none is: a goal or a fork needs one to live in. */
  ensure(): Thread {
    const open = this.open
    if (open) return open
    const made = this.fresh()
    this.show(made)
    return made
  }

  /** A new chat started outside the panel - the quick question, Ctrl Ctrl (#1115): the
   *  chat a message typed into the panel starts, the same context, tools, permissions,
   *  model and history, in the panel's list at once and opened there like any other,
   *  while the chat open in the panel stays open. `around` and `chips` are what was in
   *  front where it was asked, read the way the panel reads them (around.ts). Answers the
   *  thread, which `sendIn` goes on in, and how the message ended. */
  startHere(
    text: string,
    chips: Mention[],
    around: Around,
  ): { thread: Thread; ended: Promise<Ended> } {
    // Where the panel has never been drawn, the store learns the spaces here.
    this.know(workspace.spaces.map((one) => one.id))
    this.here(workspace.activeSpaceId ?? '')
    const thread = this.fresh()
    this.live.set(thread.id, thread)
    return { thread, ended: this.sendIn(thread, text, chips, around) }
  }

  /** A message more in a chat, from outside the panel: a quick question's follow-up. */
  sendIn(thread: Thread, text: string, chips: Mention[], around: Around): Promise<Ended> {
    return new Promise((settle) => {
      this.enqueue(thread, { id: crypto.randomUUID(), text, chips, around, settle })
    })
  }

  /** The turns of the chat drawn somewhere besides the panel (the quick question's
   *  sheet), brought up to date once a frame as its answer arrives. */
  watched = $state.raw<{ id: string; turns: readonly Turn[] } | null>(null)
  private watching: Thread | null = null
  private readonly drawWatched = onceAFrame(() => {
    const thread = this.watching
    this.watched = thread ? { id: thread.id, turns: [...thread.turns] } : null
  })

  /** Draws `thread`'s turns into `watched` as they change, or stops. */
  watch(thread: Thread | null): void {
    this.watching = thread
    this.watched = thread ? { id: thread.id, turns: [...thread.turns] } : null
  }

  /** A thread a command made (a fork, a subtask, a batch's helper): written down, in the
   *  list, and in front where `open` says. */
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

  /** A new thread started out of sight, in the list and running there: a task done with
   *  AI (#325). On the provider, model and effort a new thread asks, in `mode`. */
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

  /** A thread a command changed outside a send (its goal moved, a line it added): drawn
   *  again where it is open, and written down. */
  touched(thread: Thread): void {
    this.live.set(thread.id, thread)
    this.relist()
    if (thread === this.open) {
      this.everything = true
      this.draw()
    }
    if (thread.turns.length) void keepThread(thread).catch(() => undefined)
  }

  /** The agent said something new in `thread` (an answer, a question for the reader):
   *  unread until the reader sees it (#1064). Written down with what it said. */
  answered(thread: Thread): void {
    thread.answered = Date.now()
    this.live.set(thread.id, thread)
    this.relist()
    if (thread.turns.length) void keepThread(thread).catch(() => undefined)
  }

  /** The reader has the thread in view with its latest answer (Conversation.svelte):
   *  read, here and wherever it is kept. Its helpers' answers are read with it. */
  async saw(id: string): Promise<void> {
    const thread = this.threadOf(id) ?? (await this.held(id))
    if (!thread) return
    const seen = Date.now()
    thread.seen = seen
    this.relist()
    if (thread.turns.length) await keepThread(thread).catch(() => undefined)
  }

  /** The thread list in the conversation's place; asked again with nothing to search
   *  for while it is there, the conversation back (the side's Chats button). */
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

  /** What the thread list's field holds. */
  listQuery = $state('')

  focus(): void {
    this.focusAsked++
  }

  // ── Drawing ────────────────────────────────────────────

  /** The open thread's copy, brought up to date. */
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

  /** One engine event. Every one of them for the open thread asks for a frame; one
   *  for another thread only matters once it is done. */
  private heard(thread: Thread, event: EngineEvent): void {
    if (event.type === 'turn') {
      this.changed.add(event.turn.id)
      if (event.turn.role === 'you') {
        if (event.turn.steered) this.tookSteered(thread, event.turn.draft?.text ?? '')
        else this.pending = without(this.pending, thread.id)
      }
    } else if (event.type === 'part') {
      this.changed.add(event.turn)
      // A question for the reader is an answer they have not seen, until they do, and
      // the chat waits on them; anything after it is the agent going on.
      if (event.part.kind === 'tool' && event.part.state === 'asking') {
        this.answered(thread)
        this.move(thread, { type: 'ask' })
      } else this.move(thread, { type: 'answered' })
    } else if (event.type === 'done') {
      this.everything = true
    }
    if (thread === this.open) this.draw()
    if (thread === this.watching) this.drawWatched()
  }

  // ── Sending ────────────────────────────────────────────

  /** Sends the field: queued behind a running turn, run at once otherwise. */
  submit(around: Around): void {
    const text = this.text.trim()
    const chips = this.chips
    if (!text && !chips.length) return
    const edited = this.editing
    this.chips = []
    this.taken()
    const thread = this.open
    if (edited && thread) {
      // An old message changed: the notes and the conversation go back to before it,
      // what followed is kept as a branch, and the words are sent in its place.
      void editMessage(thread, edited, text, this)
      return
    }
    this.say(text, chips, around)
  }

  /** The reader's message being changed in the field, by its id (Up, or its pencil). */
  editing = $state<string | null>(null)

  /** What the field held when an earlier or a queued message was put in it to change:
   *  given back once that message is sent, or the edit is let go (Escape). */
  private aside: { text: string; chips: Mention[] } | null = null

  /** A queued message taken into the field to change, its thread, and where it stood in
   *  the queue: put back there if the change is let go. */
  private requeue = $state.raw<{ one: Queued; at: number; thread: Thread } | null>(null)

  /** Threads that ended an answer with nothing to send next while their queued message
   *  was in the field: what is put back in their queue is sent, since no answer ending
   *  will send it. A stop is not among them; it pauses the queue. */
  private owed = new Set<string>()

  /** Whether the field holds a message being changed, an earlier one or a queued one:
   *  what Escape and the pencil over the field let go. */
  get changing(): boolean {
    return this.editing !== null || this.requeue !== null
  }

  /** The field's words and chips set aside, the first time an edit takes the field. */
  private setAside(): void {
    this.aside ??= { text: this.text, chips: this.chips }
  }

  /** A message into the field to change and send again: the one named, else the last
   *  (Up on an empty field). */
  startEdit(turn?: string): void {
    const thread = this.open
    if (!thread || this.running.includes(thread.id)) return
    const message = turn ? thread.turns.find((one) => one.id === turn) : lastMessage(thread)
    if (!message?.draft) return
    // A queued message in the field goes back first, as changed so far. It waits there
    // for this change: sent or let go, the queue goes on after it.
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

  /** The edit let go, a queued message back in its own words: the thread whose queue
   *  may go on now. */
  private letGo(): Thread | null {
    const held = this.requeue
    const thread = held?.thread ?? this.open
    // The field first, so a message that cannot go out comes back in front of the draft.
    this.taken()
    this.putBack(held, false)
    return thread
  }

  /** The field taken by the review (a rewind, its Redo): a queued message there goes
   *  back as changed so far, to wait its turn, and an edit of an earlier one is over. */
  release(): void {
    this.putBack(this.requeue, true)
    this.taken()
  }

  /** The field's words gone from it (sent, steered, run as a command): an edit they
   *  were is over, and the field gets back what it held before the edit took it. */
  taken(): void {
    this.editing = null
    this.requeue = null
    this.text = this.aside?.text ?? ''
    if (this.aside) this.chips = this.aside.chips
    this.aside = null
  }

  /** A queued message being changed back where it stood, in the words it had (or, with
   *  `changed`, the field's words now). */
  private putBack(held: typeof this.requeue, changed: boolean): void {
    if (!held) return
    if (this.requeue === held) this.requeue = null
    // A field emptied keeps the words it had: an empty message is never queued.
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

  /** A queue no answer ending will send, sent now: in order, from its first. Not for a
   *  chat deleted or archived meanwhile. */
  private drain(thread: Thread): void {
    if (!this.owed.has(thread.id) || this.running.includes(thread.id)) return
    this.owed.delete(thread.id)
    if (this.live.get(thread.id) !== thread || thread.archived) return
    // Where nothing can answer, it waits in its own queue rather than coming back in
    // the field of another chat.
    if (thread !== this.open && !ai.provider(thread.provider)) return
    this.next(thread)
  }

  /** The rewind sheet (Esc Esc on an empty field, or a message's clock). */
  rewind(turn?: string): void {
    const thread = this.open
    if (thread) openRewind(thread, this, turn)
  }

  /** `send` for the commands: words, with what the field's chips say now. */
  send(text: string): void {
    this.say(text, [], this.around?.() ?? { front: null, selection: '' })
  }

  /** How the panel says what is around the field; set by the panel. */
  around: (() => Around) | null = null

  private say(text: string, chips: Mention[], around: Around): void {
    const thread = this.open ?? this.fresh()
    if (!this.open) this.show(thread)
    this.enqueue(thread, { id: crypto.randomUUID(), text, chips, around })
  }

  /** A send in a thread: run at once, or queued behind the one running there. */
  private enqueue(thread: Thread, send: Queued): void {
    this.live.set(thread.id, thread)
    if (this.running.includes(thread.id)) {
      this.queued = { ...this.queued, [thread.id]: [...(this.queued[thread.id] ?? []), send] }
      return
    }
    void this.run(thread, send)
  }

  /** Words sent in any thread for a command (a goal's next turn, a helper's task), as
   *  the field sends them, and how that send ended (docs/ai-sidebar.md 6.5). `once` is
   *  that send's own mode, model and effort, and the signal that stops it alone. */
  turn(thread: Thread, text: string, once?: Once): Promise<Ended> {
    return this.turnWith(thread, text, [], once)
  }

  /** The same, with words attached as chips of fixed words. */
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
    const stop = () => stopper.abort()
    once?.signal?.addEventListener('abort', stop)
    // A send's own mode, model and effort are the thread's for that send alone.
    const before = { mode: thread.mode, model: thread.model, effort: thread.effort }
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
      await this.finish(
        thread,
        !stopper.signal.aborted,
        stopper.signal.aborted ? 'stopped' : ended.stop,
      )
    }
    send.settle?.(ended)
    // A stop pauses the queue: what was waiting stays, to be sent or taken back.
    if (!stopper.signal.aborted) this.next(thread)
  }

  /** A message that could not be sent, back in the field: in front of what the field
   *  holds now (a draft an edit set aside, words typed since), so neither is lost. */
  private giveBack(text: string): void {
    const now = this.text.trim()
    if (now === text.trim()) return
    this.text = now ? `${text}\n\n${this.text}` : text
  }

  /** A thread starts answering: its stop, its mark in the list, its message drawn. */
  private begin(thread: Thread, text?: string): AbortController {
    const stopper = new AbortController()
    // Whatever the thread does now takes the place of waiting for its plan to reset.
    this.unwait(thread.id)
    // An answer that ends goes on to the queue itself.
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

  /** A thread is done answering, however it ended: drawn whole and written down; an
   *  answer the reader did not stop is one for them to see (`replied`). */
  private async finish(thread: Thread, replied = false, stop: Stop = 'end'): Promise<void> {
    if (replied && thread.turns.at(-1)?.role === 'model') thread.answered = Date.now()
    this.stoppers.delete(thread.id)
    this.running = this.running.filter((one) => one !== thread.id)
    this.relist()
    this.move(thread, { type: 'end', stop, busy: tasks.of(thread.id).length > 0 })
    this.pending = without(this.pending, thread.id)
    // Words steered in that the answer never took (sent before it was ready for them, or
    // after its last step) are the next message, first in the queue: never lost.
    const untaken = this.steering[thread.id] ?? []
    this.steering = without(this.steering, thread.id)
    this.queueFirst(thread, untaken)
    const followed = this.following.delete(thread.id)
    this.everything = true
    if (thread === this.open) this.redraw()
    if (thread === this.watching) this.drawWatched()
    if (!thread.turns.length) {
      // Nothing was sent after all: it follows the reader's space again, and the
      // provider Ask uses where it did before the send (not one picked for it).
      if (thread === this.open) {
        this.here(this.space)
        if (followed) this.follow(this.providerForNew())
      }
      return
    }
    await keepThread(thread).catch(() => undefined)
    if (thread === this.open) rememberOpen(thread.id)
    await this.refreshHeads()
  }

  /** An answer other than a send's (Ask again, a compaction) done: what was queued
   *  meanwhile goes next, as after a send, unless it was stopped. */
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

  /** One send through the engine, and how it ended, in the commands' terms. */
  private async sendDraft(
    thread: Thread,
    provider: Provider,
    draft: Draft,
    stopper: AbortController,
  ): Promise<Ended> {
    // Deleted while its message was gathered: nothing is asked. A stop is the engine's,
    // which keeps the message and says it was stopped, as does a delete that failed.
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
    // How long the answer worked, for the row its steps fold into (steps.ts).
    if (ended.turn) ended.turn.took = Date.now() - ended.turn.at
    if (ended.stop === 'error' && ended.limit?.state === 'reached' && ended.limit.until !== null)
      this.resets = { ...this.resets, [thread.id]: { until: ended.limit.until, waiting: false } }
    // A send refused before any turn (no provider, no engine) has nowhere to say so but
    // under the thread.
    if (ended.stop === 'error' && !ended.turn && ended.error) throw new Error(ended.error)
    return ended
  }

  private next(thread: Thread): void {
    const [first, ...rest] = this.queued[thread.id] ?? []
    if (!first) {
      // Nothing left to send, while a queued message is out in the field.
      if (this.requeue?.thread === thread) this.owed.add(thread.id)
      return
    }
    this.queued = { ...this.queued, [thread.id]: rest }
    void this.run(thread, first)
  }

  /** Words into the running turn (Ctrl+Enter): taken after the call in flight. With
   *  nothing running the field sends them itself, as Enter does (its chips, a typed
   *  command), so they stay in the field here. */
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
        // Not ready for them yet (still gathered, compacted, set up): the next message,
        // first in the queue, rather than words the answer never hears.
        if (!took && this.tookSteered(thread, text)) this.queueFirst(thread, [text])
      })
  }

  /** Steered words out of those shown waiting: these words, not the first. False
   *  where they are not there (the answer ended and queued them already). */
  private tookSteered(thread: Thread, text: string): boolean {
    const list = this.steering[thread.id] ?? []
    const at = list.indexOf(text)
    if (at < 0) return false
    const left = list.slice()
    left.splice(at, 1)
    this.steering = { ...this.steering, [thread.id]: left }
    return true
  }

  /** Words sent next in a thread, before what was queued there. */
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

  /** Stops the open thread's turn, and everything it started (helpers.stopUnder); what
   *  arrived stays. */
  stop(): void {
    const id = this.open?.id
    if (id) this.stopIn(id)
  }

  /** The same, for any chat: one the quick question's sheet draws. */
  stopIn(id: string): void {
    this.stoppers.get(id)?.abort()
    void import('../helpers/helpers.svelte').then(({ helpers }) => {
      helpers.stopUnder(id)
    })
  }

  get busy(): boolean {
    return !!this.head && this.running.includes(this.head.id)
  }

  // ── The queue ──────────────────────────────────────────

  private setQueue(list: Queued[]): void {
    const id = this.open?.id
    if (id) this.queued = { ...this.queued, [id]: list }
  }

  get queue(): Queued[] {
    const id = this.head?.id
    return id ? (this.queued[id] ?? []) : []
  }

  /** Off the queue. A command waiting on it hears that it was stopped. */
  unqueue(id: string): void {
    this.queue.find((one) => one.id === id)?.settle?.({ stop: 'stopped', turn: null, usage: null })
    this.setQueue(this.queue.filter((one) => one.id !== id))
  }

  /** A queued message back in the field, to change before it goes. */
  editQueued(id: string): void {
    const thread = this.open
    if (!thread || !this.queue.some((each) => each.id === id)) return
    // One message being changed at a time: a queued one there goes back, as changed,
    // and an earlier one is let go, so Enter never sends these words in its place.
    this.putBack(this.requeue, true)
    this.editing = null
    const at = this.queue.findIndex((each) => each.id === id)
    const one = this.queue[at]
    if (!one) return
    this.unqueue(id)
    this.setAside()
    // Back in the queue without what a command waited on: `unqueue` told it already.
    const back: Queued = { ...one }
    delete back.settle
    this.requeue = { one: back, at, thread }
    this.text = one.text
    this.chips = one.chips
    this.focus()
  }

  /** A queued message sent into the running turn now (Copilot's Steer). */
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

  /** The last message again, in place of its answer (Ask again); with a model named,
   *  that model answers this time and from here on (retry with another model) - once the
   *  switch has been asked about like any other (`chooseModel`), and not at all where the
   *  reader said no. */
  retry(model?: { provider: string; id: string }, thread = this.open): void {
    if (!thread || this.running.includes(thread.id)) return
    if (model) {
      void this.chooseModel(model.provider, model.id).then((switched) => {
        if (switched) this.retry(undefined, thread)
      })
      return
    }
    let at = thread.turns.length - 1
    while (at >= 0 && (thread.turns[at]?.role !== 'you' || thread.turns[at]?.steered)) at--
    const asked = thread.turns[at]
    if (!asked?.draft) return
    // Nothing is taken back where nothing can ask again.
    const provider = ai.provider(thread.provider)
    if (!provider) {
      if (thread === this.open) this.trouble = t('Add an AI provider in Settings first.')
      return
    }
    const taken = thread.turns.splice(at)
    this.everything = true
    this.redraw()
    const stopper = this.begin(thread, asked.draft.text)
    let stop: Stop = 'end'
    void this.sendDraft(thread, provider, asked.draft, stopper)
      .then((ended) => (stop = ended.stop))
      .catch((error: unknown) => {
        stop = 'error'
        // Refused before any turn: the message and its answer back as they were.
        if (thread.turns.length === at) thread.turns.push(...taken)
        if (thread === this.open) this.trouble = message(error, t('The model did not answer.'))
      })
      .finally(() => void this.ended(thread, stopper, true, stop))
  }

  /** The open thread's last message again a little after its plan resets (the button
   *  under the limit), or that taken back. Kept while other chats are open, not over a
   *  restart. */
  waitForReset(on: boolean): void {
    const thread = this.open
    const reset = thread && this.resets[thread.id]
    if (!thread || !reset) return
    clearTimeout(this.timers.get(thread.id))
    this.resets = { ...this.resets, [thread.id]: { until: reset.until, waiting: on } }
    // Waiting on the plan is waiting; taken back, it is the failure it was.
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

  // ── Mode, model, effort ────────────────────────────────

  setMode(mode: Mode): void {
    const thread = this.open
    rememberMode(mode)
    if (!thread) return
    thread.mode = mode
    this.changedHead(thread)
  }

  /** Shift+Tab: Approve, Agent, Plan, and round again. */
  nextMode(): void {
    this.setMode(nextMode(this.open?.mode ?? lastMode()))
  }

  /** A provider's models, asked once a session. A list that cannot be had leaves the
   *  popover with the model the thread already has. */
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

  /** Another model for the open thread, by whatever way it was asked for - the model
   *  picker, `/model`, an agent's profile, Ask again with another model. The one door a
   *  thread changes model through: `switchModel`, which does it, is this class's own.
   *  Asked about first where the switch sends the conversation again (#1089,
   *  switch-cost.ts) - how many tokens that is about, and that it is compacted first where
   *  it does not fit the new model - unless the reader said not to ask again. Whether it
   *  switched. */
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
    // Compacted by the model that has read it, before another one has to.
    if (cost?.compacts && this.open === thread) await this.compacted()
    if (this.open !== thread) return false
    this.switchModel(provider, model)
    return true
  }

  /** Another model for this thread, and the effort last used with it: only ever through
   *  `chooseModel`. */
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

  /** A change to what the controls show, written down where the thread is kept. */
  private changedHead(thread: Thread): void {
    if (thread === this.open) this.head = headOf(thread)
    this.relist()
    if (thread.turns.length) void keepThread(thread).catch(() => undefined)
  }

  // ── Context ────────────────────────────────────────────

  compact(focus?: string): void {
    void this.compacted(focus)
  }

  /** The same, done once it is: what a switch of model waits on before it switches. */
  private compacted(focus?: string): Promise<void> {
    const thread = this.open
    const provider = this.provider
    if (!thread?.turns.length || !provider || this.running.includes(thread.id))
      return Promise.resolve()
    const stopper = this.begin(thread)
    let stop: Stop = 'end'
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

  /** A chip the panel offered on its own, taken off for this thread. */
  drop(key: string): void {
    if (!this.dropped.includes(key)) this.dropped = [...this.dropped, key]
  }

  // ── The thread's own menu ──────────────────────────────

  /** The open thread renamed, or the one the list names (its row's menu). */
  async rename(name?: string, id = this.open?.id): Promise<void> {
    const thread = id ? await this.held(id) : null
    if (!thread) return
    const named = name ?? (await prompt.ask({ title: t('Rename'), value: thread.title }))
    if (!named?.trim()) return
    thread.title = named.trim()
    this.changedHead(thread)
    void this.refreshHeads()
  }

  /** A copy of the thread up to here, and the reader in it (`/branch`); from an answer's
   *  own menu, up to that answer (ChatGPT's "Branch in new chat"). */
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

  /** A quick question's conversation (Ctrl Ctrl), carried on as a thread of its own in
   *  the panel: Raycast's and Arc's way from a quick answer to a conversation. */
  continueFrom(turns: readonly { role: 'you' | 'model'; text: string }[], space: string): void {
    const provider = this.providerForNew()
    const thread = threadFromAsk(turns, space, provider?.id ?? '', provider?.model ?? '')
    if (!thread) return
    thread.mode = lastMode()
    this.adopt(thread, true)
    rememberOpen(thread.id)
    this.focus()
  }

  /** Dictation into the field (`/voice`, the round button on an empty field). */
  voice(on?: boolean): void {
    void import('./dictate.svelte').then(({ dictation }) => dictation.toggle(on))
  }

  /** A thread by id: the one in hand, else the one kept. */
  private async held(id: string): Promise<Thread | null> {
    const live = this.live.get(id)
    if (live) return live
    const read = await readThread(this.spaceOf(id), id).catch(() => null)
    // In hand from now on, so what changes it is the list's at once (`merged`); one
    // taken meanwhile is the one changed.
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

  /** A note made of the open thread's words (Save as a note), opened: in the thread's
   *  own space, whose notes its citations name, and never in the space in front. Where
   *  that space is not on this device or may only be read, no note, and a line in the
   *  thread that says why. */
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

  /** A chat gone from the list: nothing more of its queue is sent once it is done, and
   *  the field gets back what it held. A queued message of it in the field is back in
   *  its queue where the chat is `kept` (archived), with the rest, else dropped. */
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
    // Marked deleted before its answer is stopped, so a message still being gathered
    // asks nothing.
    const deleting = deleteThread(this.spaceOf(id), id).then(
      () => true,
      () => false,
    )
    this.relist()
    this.stoppers.get(id)?.abort()
    this.unwait(id)
    this.forgetEdit(id)
    for (const one of this.queued[id] ?? [])
      one.settle?.({ stop: 'stopped', turn: null, usage: null })
    this.queued = without(this.queued, id)
    // A delete the crate refused leaves the chat as it is, in the list.
    if (!(await deleting)) {
      this.relist()
      await this.refreshHeads()
      return
    }
    // What it started ends with it, once it is gone: a refused delete leaves it running.
    void import('../helpers/helpers.svelte').then(({ helpers }) => {
      helpers.stopUnder(id)
      helpers.forget(id)
    })
    this.live.delete(id)
    if (this.open?.id === id) this.newThread()
    await this.refreshHeads()
  }
}

export const chat = new Chat()

// Work starting and ending out of sight moves its thread (#1089).
tasks.watch((id) => chat.worked(id))

// The ✦ tab's dot, kept with the list (#1064).
panelKeepsUnread()
$effect.root(() => {
  $effect(() => {
    chatsUnread.any = chat.unread.size > 0
  })

  // The space in front is where a new chat starts, and nothing more: the chats are one
  // list, every space's, and the open one stays open as the space changes (#332). Kept by
  // the store rather than by the panel (#1115): a chat started where the panel is not
  // drawn - Ctrl Ctrl - is one of these spaces' and in their list like any other.
  // Untracked, so what the store reads while it changes threads is not something these
  // effects wait on: only the space, and which spaces there are.
  $effect(() => {
    const space = workspace.activeSpaceId ?? ''
    untrack(() => chat.here(space))
  })
  $effect(() => {
    const spaces = workspace.spaces.map((one) => one.id)
    untrack(() => chat.know(spaces))
  })

  // A thread not yet sent asks whichever provider Ask is set to now.
  $effect(() => {
    const provider = ai.providerFor('ask')
    untrack(() => chat.follow(provider))
  })
})

// A call of a thread's that names no space works in the thread's space, not the one in
// front (docs/ai-sidebar.md 4.11): its helpers' too, which are threads of their own.
answerThreadSpaces(
  (id) => chat.threadOf(id)?.space ?? chat.every.find((one) => one.id === id)?.space ?? null,
)

/** The space a thread works in: its own, and the one in front where it names none this
 *  device has. What its message is gathered in and its sources are paths in. */
function spaceOfThread(thread: Thread): { id: string; root: string } | null {
  return workspace.spaces.find((one) => one.id === thread.space) ?? workspace.activeSpace ?? null
}
