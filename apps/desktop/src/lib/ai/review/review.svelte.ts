/** The review of what the sidebar's agent changed (docs/ai-sidebar.md 4.5): the
 *  changes of each thread, Keep and Undo, the marks in the notes, rewinding to a
 *  message, Redo, and editing a message.
 *
 *  Nothing underneath is new. An agent's edits are live transactions, each a step of
 *  its own that can be taken back through whatever was typed since
 *  (lib/agents/docs/track.ts); this reads those steps, says which thread made each
 *  one (changes.ts), and takes some of them back through the same machinery the
 *  palette's "Undo edits by" uses. Keep only says the reader has read a change: the
 *  edit was already in the note.
 *
 *  Like the steps it reads, it lasts the session. Fetched with the panel; nothing of
 *  it is in the first paint. */

import { SvelteSet } from 'svelte/reactivity'
import { carryIntoEditors, type SharedDoc, StateEffect } from '@orden/editor'
import {
  type ReviewMark,
  reviewMarks,
  setReviewActions,
  setReviewMarks,
  setReviewSource,
} from '@orden/editor/review'
import {
  onTracks,
  putBackIn,
  trackedAgents,
  tracksAside,
  tracksOf,
  undoSomeIn,
} from '../../agents/docs'
import { busy } from '../../busy.svelte'
import { plural, t } from '../../i18n.svelte'
import { insideSpace, notePath, withinSpace } from '../../space-paths'
import { dur } from '../../motion'
import { onDisk } from '../../on-disk'
import { onceAFrame } from '../../timing'
import { workspace } from '../../workspace.svelte'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { writeFile } from '../../workspace/write-file'
import { answeringAt, onSend, onSent } from '../chat/sends'
import type { Thread, Turn } from '../chat/types'
import { cutForEdit } from './branches'
import {
  agentOf,
  type Change,
  byNote,
  changesOf,
  type Edit,
  type NoteChanges,
  providerOf,
  providersOf,
  type Reviewed,
} from './changes'
import { markUnmade, redoFile, undoFile } from './file-ops'
import { type FileChange, fileChangesOf, spaceNamed } from './files'
import { type Choice, type Made, planFor, type Plan, type Step } from './plan'
import { summarized } from './summary'

/** What the review needs of the panel: the field, a send, and a thread changed
 *  outside a send drawn again and written down (docs/ai-sidebar.md 6.6). */
export interface ReviewPanel {
  send(text: string): void
  text?: string
  touched?(thread: Thread): void
  /** A change in the field let go before the review writes the field. */
  release?(): void
}

/** One thing a rewind took back, in a form to do again. */
type Taken =
  /** Edits under a token of their own, wherever their notes have got to since. */
  | { kind: 'edits'; token: string; agents: string[] }
  | { kind: 'made'; id: string; path: string; words: string }
  | { kind: 'file'; file: FileChange }

/** What a rewind took back, to put back with Redo until the next message. */
interface Redo {
  thread: string
  /** What is left to do again, the first taken back first; done from the end. */
  taken: Taken[]
  turns: Turn[] | null
  /** The compaction those turns held up, which Redo brings back with them. */
  compaction?: Thread['compaction']
}

/** Said of a rewind or a Redo that left something as it was. */
function saidShort(): void {
  busy.failed(t('Part of this could not be undone'))
}

/** How long a kept change's tint takes to fade: `--dur-stage`. */
const FADE = 170

/** The note a document is of, as the agents' steps name it. */
function keyOf(note: NoteDoc): string {
  return note.path ?? `unsaved:${note.key}`
}

/** The open document a note is, by the key above. */
function documentOf(path: string): NoteDoc | null {
  return workspace.documents.find((one) => keyOf(one) === path) ?? null
}

/** A turn's words, put back into the field. */
function wordsOf(turn: Turn): string {
  return turn.draft?.text ?? ''
}

class Review {
  /** Moves whenever any agent's edits change. */
  private version = $state(0)
  /** The changes the reader kept, by id. */
  readonly kept = new SvelteSet<string>()
  /** The file changes kept or taken back, by their call's id. */
  readonly filesDone = new SvelteSet<string>()
  /** Kept a moment ago, still fading out of the note. */
  private readonly fading = new SvelteSet<string>()
  /** The changes list, open for this thread. */
  listing = $state<string | null>(null)
  /** The rewind sheet: the thread, the panel that asked, and the message picked. */
  sheet = $state.raw<{ thread: Thread; panel: ReviewPanel | null; turn: string | null } | null>(
    null,
  )
  /** What the last rewind can put back. */
  redo = $state.raw<Redo | null>(null)
  /** A few words the bar says for a moment: "and 1 after it". */
  said = $state<string | null>(null)
  /** The threads whose edits bring their note to the front as they land (Follow, Zed's
   *  word; off unless the reader turns it on). */
  readonly following = new SvelteSet<string>()

  /** The newest edit heard in each note, by agent and note: what tells an edit landing
   *  from one taken back, for Follow. */
  private readonly landed = new Map<string, { id: string; at: number }>()
  private marked = new WeakSet<NoteDoc>()
  private readonly draw = onceAFrame(() => this.pushMarks())
  private saidTimer: ReturnType<typeof setTimeout> | undefined
  /** A Redo running, which a second press must not start again. */
  private puttingBack = false

  constructor() {
    onTracks((agent, path, was) => {
      this.version++
      this.draw()
      if (was === undefined) this.follow(agent, path)
      else this.landedMoved(agent, was, path)
    })
    onSend((thread) => {
      if (this.redo?.thread === thread) this.forgetRedo()
    })
    // A note moved or deleted is read off the turn, which is whole once its send ends.
    onSent(() => this.version++)
    setReviewSource((doc) => this.marksOfDoc(doc))
    // The marks are fetched with the review: every editor made from now on carries
    // them, and every note open now is handed them.
    carryIntoEditors(reviewMarks())
    for (const note of workspace.documents)
      note.live.announce([StateEffect.appendConfig.of(reviewMarks())])
    setReviewActions((id, keep) => {
      const change = this.edits().find((one) => one.id === id)
      if (!change) return
      if (keep) this.keep([change])
      else void this.undo([change])
    })
  }

  // ── Reading ─────────────────────────────────────────────

  /** Every edit of the sidebar's agents still there to take back, open notes brought
   *  up to date first. */
  edits(agents = trackedAgents().filter((one) => providerOf(one) !== null), aside = false): Edit[] {
    this.heard()
    const edits: Edit[] = []
    for (const agent of agents) {
      const away = aside ? tracksAside(agent) : []
      for (const [path, track] of [...tracksOf(agent), ...away]) {
        // Whatever is open at the name of a note deleted is another note.
        const open = away.some(([, one]) => one === track) ? null : documentOf(path)
        if (open) track.follow(open)
        for (const id of track.ids) {
          const thread = track.threadOf(id)
          edits.push({
            id,
            agent,
            path,
            at: track.madeAt(id),
            spots: track.spansOf(id),
            ...(thread ? { thread } : {}),
          })
        }
      }
    }
    return edits
  }

  /** A thread's changes the reader has not kept, oldest first. */
  changes(thread: Reviewed, deleted = true): Change[] {
    // A helper works on any provider in use (`run_agent`), so a thread with helpers reads
    // every built-in agent's edits; `changesOf` keeps those of its own threads.
    const agents = thread.helpers?.length ? undefined : providersOf(thread).map(agentOf)
    // With those of a note deleted: a rewind puts it back on the way to them.
    return changesOf(thread, this.edits(agents, deleted), answeringAt, this.kept)
  }

  /** The same by note, for the card: not those of a note deleted, which have nothing to
   *  be taken back in until the note is back. */
  notes(thread: Reviewed): NoteChanges[] {
    return byNote(this.changes(thread, false))
  }

  /** The notes a thread moved or deleted that the reader has not kept, oldest first. */
  files(thread: Pick<Thread, 'turns'>): FileChange[] {
    this.heard()
    return fileChangesOf(thread.turns, this.filesDone)
  }

  /** What rewinding a thread to its message `turn` would do. */
  plan(thread: Thread, turn: string): Plan | null {
    return planFor(thread, turn, this.changes(thread), this.filesDone)
  }

  // ── Keep and Undo ──────────────────────────────────────

  /** The reader has read these: their marks fade and they leave the list. */
  keep(changes: readonly Change[] | readonly Edit[]): void {
    for (const change of changes) {
      this.kept.add(change.id)
      this.fading.add(change.id)
    }
    this.draw()
    setTimeout(() => {
      for (const change of changes) this.fading.delete(change.id)
      this.draw()
    }, dur(FADE))
  }

  /** These taken back, each through everything since. Answers how many later edits
   *  went with them because they rewrote their words, and says so for a moment. A note
   *  that could not be reached keeps nothing of the others from going, and is said. */
  async undo(changes: readonly Edit[], token?: string): Promise<number> {
    const { more, short } = await this.take(changes, token)
    if (more) this.say(plural(more, { one: 'and {count} after it', other: 'and {count} after it' }))
    if (short) saidShort()
    return more
  }

  /** The taking back itself: how many went beyond those asked, and whether any stayed. */
  private async take(
    changes: readonly Edit[],
    token?: string,
  ): Promise<{ more: number; short: boolean }> {
    let more = 0
    let short = false
    for (const [key, group] of this.grouped(changes)) {
      const [agent = '', path = ''] = key.split('\n')
      const asked = new Set(group.map((one) => one.id))
      const went = await undoSomeIn({ id: agent, name: agent }, path, asked, token).catch(
        (error: unknown): string[] => {
          console.warn(`no edits taken back in ${path}: ${String(error)}`)
          return []
        },
      )
      more += went.filter((id) => !asked.has(id)).length
      if ([...asked].some((id) => !went.includes(id))) short = true
    }
    return { more, short }
  }

  /** All of a thread's card taken back: the moves and deletes first, so that a note edited
   *  and then deleted is there for its edits to go back in, which come back with it. */
  async undoAll(thread: Reviewed & Thread, files: readonly FileChange[]): Promise<void> {
    await this.undoFiles(thread, files)
    await this.undo(this.changes(thread, false))
  }

  /** All of a thread's card kept, the edits of a note deleted with it: back, it does not
   *  ask again about what was kept. */
  keepAll(thread: Reviewed, files: readonly FileChange[]): void {
    this.keep(this.changes(thread))
    this.keepFiles(files)
  }

  /** Moves and deletes the reader has read: they leave the list. */
  keepFiles(files: readonly FileChange[]): void {
    for (const one of files) this.filesDone.add(one.id)
  }

  /** Moves and deletes taken back, newest first, so a note moved twice goes back the
   *  way it came. Answers those that were. */
  async undoFiles(thread: Thread, files: readonly FileChange[]): Promise<FileChange[]> {
    const undone: FileChange[] = []
    for (const one of [...files].reverse()) {
      if (!(await undoFile(one, thread))) continue
      this.filesDone.add(one.id)
      undone.unshift(one)
    }
    return undone
  }

  /** Changes by the agent and the note they are in now, which is what one take is of: a
   *  step taken back before them may have moved the note since they were read. */
  private grouped(changes: readonly Edit[]): [string, Edit[]][] {
    const groups: Record<string, Edit[]> = {}
    for (const change of changes) {
      const now = [...tracksOf(change.agent)].find(([, track]) => track.ids.includes(change.id))
      ;(groups[`${change.agent}\n${now?.[0] ?? change.path}`] ??= []).push(change)
    }
    return Object.entries(groups)
  }

  /** Reads the version, so whatever asked is asked again when an agent's edits change. */
  private heard(): number {
    return this.version
  }

  private say(words: string): void {
    this.said = words
    clearTimeout(this.saidTimer)
    this.saidTimer = setTimeout(() => (this.said = null), 3000)
  }

  /** Opens the note a change is in, at the change. */
  async show(change: Pick<Edit, 'path' | 'spots'>): Promise<void> {
    if (change.path.startsWith('unsaved:')) return
    await workspace.open(change.path)
    const note = documentOf(change.path)
    const from = change.spots[0]?.from ?? 0
    if (note)
      workspace.goto = {
        path: change.path,
        line: note.live.text.lineAt(Math.min(from, note.live.text.length)).number - 1,
      }
  }

  /** Follow on or off for a thread. */
  toggleFollow(thread: Pick<Thread, 'id'>): void {
    if (this.following.has(thread.id)) this.following.delete(thread.id)
    else this.following.add(thread.id)
  }

  /** What was heard in a note goes with it, or its next step taken back reads as a landing. */
  private landedMoved(agent: string, was: string, path: string): void {
    const seen = this.landed.get(`${agent}\n${was}`)
    if (!seen) return
    this.landed.delete(`${agent}\n${was}`)
    this.landed.set(`${agent}\n${path}`, seen)
  }

  /** A note an agent just wrote in, brought to the front where the thread answering
   *  for it follows: only in the space in front, so an agent working in another space
   *  never moves the reader there (docs/agent-native.md 8.6). */
  private follow(agent: string, path: string): void {
    const provider = providerOf(agent)
    // Heard for a step taken back as well as for one made: only an edit newer than any
    // heard before in the note is one landing.
    const track = tracksOf(agent).get(path)
    const last = track?.ids.at(-1)
    const key = `${agent}\n${path}`
    const seen = this.landed.get(key)
    const at = last && track ? track.madeAt(last) : 0
    const landing = !!last && last !== seen?.id && at >= (seen?.at ?? 0)
    if (landing) this.landed.set(key, { id: last, at })
    if (!landing || !this.following.size || provider === null || path.startsWith('unsaved:')) return
    const thread = track?.threadOf(last) ?? answeringAt(provider, Date.now())
    const root = workspace.activeSpace?.root
    if (!thread || !this.following.has(thread) || !root || withinSpace(root, path) === null) return
    if (workspace.active?.path !== path) void workspace.open(path)
  }

  // ── Marks in the notes ─────────────────────────────────

  /** The changes the reader has not kept in one note, as the editor draws them. */
  private marksOf(path: string): ReviewMark[] {
    const marks: ReviewMark[] = []
    for (const edit of this.edits()) {
      if (edit.path !== path) continue
      const fading = this.fading.has(edit.id)
      if (this.kept.has(edit.id) && !fading) continue
      for (const spot of edit.spots) {
        marks.push({
          id: edit.id,
          from: spot.from,
          to: spot.to,
          removed: spot.removed,
          ...(fading ? { fading: true } : {}),
        })
      }
    }
    return marks
  }

  private marksOfDoc(doc: SharedDoc): ReviewMark[] {
    const note = workspace.documents.find((one) => one.live === doc)
    return note ? this.marksOf(keyOf(note)) : []
  }

  /** Every open note told what it has now. */
  private pushMarks(): void {
    for (const note of workspace.documents) {
      const marks = this.marksOf(keyOf(note))
      if (!marks.length && !this.marked.has(note)) continue
      note.live.announce([setReviewMarks.of(marks)])
      if (marks.length) this.marked.add(note)
      else this.marked.delete(note)
    }
  }

  // ── Rewind ─────────────────────────────────────────────

  /** The rewind sheet for a thread, at a message where one was named. */
  openRewind(thread: Thread, panel: ReviewPanel | null, turn: string | null = null): void {
    this.listing = null
    this.sheet = { thread, panel, turn }
  }

  closeRewind(): void {
    this.sheet = null
  }

  /** Rewinds `thread` to before its message `turn`, the way `choice` says. */
  async rewind(
    thread: Thread,
    turn: string,
    choice: Choice,
    panel: ReviewPanel | null,
  ): Promise<void> {
    const plan = this.plan(thread, turn)
    if (!plan) return
    this.forgetRedo()
    const redo: Redo = { thread: thread.id, taken: [], turns: null }

    if (choice === 'both' || choice === 'notes') {
      const { taken, short } = await this.stepsBack(thread, plan.steps)
      redo.taken = taken
      if (short) saidShort()
    }

    const index = thread.turns.findIndex((one) => one.id === turn)
    if (choice === 'both' || choice === 'conversation') {
      redo.turns = thread.turns.splice(index)
      const compaction = thread.compaction
      this.cut(thread, panel, plan.turn)
      if (compaction && !thread.compaction) redo.compaction = compaction
    } else if (choice === 'summarize-from') {
      const summary = await summarized(thread, thread.turns.slice(index))
      thread.turns.splice(index, thread.turns.length - index, {
        id: crypto.randomUUID(),
        role: 'model',
        at: Date.now(),
        parts: [
          { kind: 'notice', code: 'compacted', text: '' },
          { kind: 'text', text: summary },
        ],
      })
      this.cut(thread, panel, plan.turn)
    } else if (choice === 'summarize-to') {
      const summary = await summarized(thread, thread.turns.slice(0, index))
      const marker: Turn = {
        id: crypto.randomUUID(),
        role: 'model',
        at: Date.now(),
        parts: [{ kind: 'notice', code: 'compacted', text: '' }],
      }
      thread.turns.splice(index, 0, marker)
      thread.compaction = { upTo: marker.id, kind: 'summary', model: thread.model, summary }
      panel?.touched?.(thread)
    }

    this.sheet = null
    if (redo.taken.length || redo.turns) this.redo = redo
  }

  /** The conversation cut: a compaction of turns now gone forgotten, a program that
   *  remembers them told, the message back in the field, the thread drawn again. */
  private cut(thread: Thread, panel: ReviewPanel | null, turn: Turn): void {
    const upTo = thread.compaction?.upTo
    if (upTo && !thread.turns.some((one) => one.id === upTo)) delete thread.compaction
    thread.updated = Date.now()
    void rewound(thread)
    if (panel) {
      panel.release?.()
      panel.text = wordsOf(turn)
      panel.touched?.(thread)
    }
  }

  /** Takes back a plan's steps in their order, each on its own: one refused - a name
   *  somebody else has taken since - keeps none of the rest from going. Answers what
   *  went, in a form to do again, and whether something stayed. */
  private async stepsBack(
    thread: Thread,
    steps: readonly Step[],
  ): Promise<{ taken: Taken[]; short: boolean }> {
    const taken: Taken[] = []
    let short = false
    for (const step of steps) {
      if (step.kind === 'edits') {
        const token = crypto.randomUUID()
        const went = await this.take(step.changes, token)
        short ||= went.short
        taken.push({
          kind: 'edits',
          token,
          agents: [...new Set(step.changes.map((one) => one.agent))],
        })
      } else if (step.kind === 'file') {
        const [back] = await this.undoFiles(thread, [step.file])
        if (back) taken.push({ kind: 'file', file: back })
        else short = true
      } else {
        const gone = await this.unmake(thread, step.made)
        if (gone === 'stayed') short = true
        else if (gone) {
          // Taken back, like a file change: a note the reader makes at the name after
          // this is theirs, and the next rewind leaves it alone.
          this.filesDone.add(step.made.id)
          taken.push({ kind: 'made', id: step.made.id, ...gone })
        }
      }
    }
    return { taken, short }
  }

  /** A note the thread made, to Recently deleted, its words kept for Redo. Null where it
   *  is not there to send, 'stayed' where it is and would not go. */
  private async unmake(
    thread: Thread,
    one: Made,
  ): Promise<{ path: string; words: string } | 'stayed' | null> {
    const space =
      (one.space ? spaceNamed(workspace.spaces, one.space) : undefined) ??
      workspace.spaces.find((each) => each.id === thread.space)
    if (!space) return 'stayed'
    const relative = notePath(one.path) ?? one.path
    const path = insideSpace(space.root, relative)
    const words = await workspace.noteText(path).catch(() => null)
    if (words === null) return (await onDisk(path)) ? 'stayed' : null
    const gone = await workspace.remove(path, false).then(
      () => true,
      () => false,
    )
    if (!gone) return 'stayed'
    markUnmade(path)
    return { path, words }
  }

  /** Whether the open thread has a rewind to put back. */
  canRedo(thread: Pick<Thread, 'id'> | null): boolean {
    return !!thread && this.redo?.thread === thread.id
  }

  /** Puts back what the last rewind took, the other way round from how it went: the
   *  notes it sent to Recently deleted, the moves and deletes, the edits through what was
   *  typed since, and the conversation. What fails stays in `redo` with what is left, to
   *  try again; none of it is lost. */
  async putBack(thread: Thread, panel: ReviewPanel | null): Promise<void> {
    const redo = this.redo
    if (redo?.thread !== thread.id || this.puttingBack) return
    this.puttingBack = true
    let short = false
    try {
      const left = [...redo.taken]
      for (let one = left.at(-1); one; one = left.at(-1)) {
        short = (await this.doAgain(one, thread)) || short
        left.pop()
        this.redo = { ...redo, taken: [...left] }
      }
      if (redo.turns) {
        thread.turns.push(...redo.turns)
        if (redo.compaction) thread.compaction = redo.compaction
        void rewound(thread)
        panel?.release?.()
        if (panel) panel.text = ''
        panel?.touched?.(thread)
      }
      this.redo = null
      if (short) saidShort()
    } catch (error) {
      console.warn(`a Redo stopped: ${String(error)}`)
      saidShort()
    } finally {
      this.puttingBack = false
    }
  }

  /** One thing done again. Answers whether it left something as it was, and throws where
   *  whatever comes after it would stand on what did not happen. */
  private async doAgain(one: Taken, thread: Thread): Promise<boolean> {
    if (one.kind === 'file') {
      await redoFile(one.file, thread)
      this.filesDone.delete(one.file.id)
      return false
    }
    if (one.kind === 'made') {
      // Only where nothing is at the name. A file there that will not read - another
      // encoding, a lock - reads as null too, and writing into it wrote over it.
      if ((await workspace.noteText(one.path).catch(() => null)) !== null) return true
      if (await onDisk(one.path)) return true
      await writeFile(one.path, one.words)
      await workspace.fileCame(one.path, 'file')
      await workspace.loadTree()
      this.filesDone.delete(one.id)
      return false
    }
    let short = false
    for (const agent of one.agents) {
      for (const [path, track] of tracksOf(agent)) {
        if (!track.holds(one.token)) continue
        const back = await putBackIn({ id: agent, name: agent }, path, one.token).catch(
          (error: unknown) => {
            console.warn(`no edits put back in ${path}: ${String(error)}`)
            return []
          },
        )
        if (!back.length) short = true
      }
    }
    return short
  }

  private forgetRedo(): void {
    const redo = this.redo
    if (!redo) return
    this.redo = null
    for (const one of redo.taken) {
      if (one.kind !== 'edits') continue
      for (const agent of one.agents) {
        for (const track of tracksOf(agent).values()) track.forgetTaken(one.token)
      }
    }
  }

  // ── Editing a message ──────────────────────────────────

  /** The reader's message `turn` sent again as `text`: the notes and the conversation
   *  back to before it, what followed kept as a branch, and the new words sent. */
  async edit(thread: Thread, turn: string, text: string, panel: ReviewPanel): Promise<void> {
    const plan = this.plan(thread, turn)
    if (!plan) return
    this.forgetRedo()
    const { short } = await this.stepsBack(thread, plan.steps)
    if (short) saidShort()
    if (!cutForEdit(thread, turn)) return
    const upTo = thread.compaction?.upTo
    if (upTo && !thread.turns.some((one) => one.id === upTo)) delete thread.compaction
    await rewound(thread)
    panel.touched?.(thread)
    panel.send(text)
  }
}

/** Tells the engine a thread's turns were cut, where it keeps a conversation of its
 *  own (Claude Code, Codex). The panel's engines, found through its setup. */
async function rewound(thread: Thread): Promise<void> {
  const setup = Object.values(import.meta.glob<SetupModule>('../sidebar/setup.ts'))[0]
  if (!setup) return
  const { ai } = await import('../store.svelte')
  const provider = ai.provider(thread.provider)
  if (!provider) return
  const engine = await (await setup()).engineOf(provider.kind).catch(() => null)
  engine?.rewound?.(thread)
}

interface SetupModule {
  engineOf(kind: import('../providers').ProviderKind): Promise<import('../chat/types').Engine>
}

export const review = new Review()
