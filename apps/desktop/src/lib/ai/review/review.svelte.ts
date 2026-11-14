import { SvelteSet } from 'svelte/reactivity'
import { carryIntoEditors, type SharedDoc, StateEffect } from '@orden/editor'
import {
  type ReviewMark,
  reviewMarks,
  setReviewActions,
  setReviewMarks,
  setReviewSource,
} from '@orden/editor/review'
import { agentDocs } from '../../agents/src/api'
import { busy } from '../../ui-kit/src/api'
import { insideSpace, notePath, withinSpace, dur, onDisk, onceAFrame } from '../../platform/src/api'
import { workspace } from '../../workspace.svelte'
import type { NoteDoc } from '../../workspace/documents.svelte'
import { writeFile } from '../../workspace/write-file'
import { answeringAt, onSend, onSent } from '../chat/sends'
import type { Thread, Turn } from '../chat/types'
import { cutForEdit } from './branches'
import {
  agentsOf,
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

const { onTracks, putBackIn, trackedAgents, tracksAside, tracksOf, undoSomeIn } = await agentDocs()

export interface ReviewPanel {
  send(text: string): void
  text?: string
  touched?(thread: Thread): void
  release?(): void
}

type Taken =
  | { kind: 'edits'; token: string; agents: string[] }
  | { kind: 'made'; id: string; path: string; words: string }
  | { kind: 'file'; file: FileChange }

interface Redo {
  thread: string
  taken: Taken[]
  turns: Turn[] | null
  compaction?: Thread['compaction']
}

function saidShort(): void {
  busy.failed('Part of this could not be undone')
}

const FADE = 170

function keyOf(note: NoteDoc): string {
  return note.path ?? `unsaved:${note.key}`
}

function documentOf(path: string): NoteDoc | null {
  return workspace.documents.find((one) => keyOf(one) === path) ?? null
}

function wordsOf(turn: Turn): string {
  return turn.draft?.text ?? ''
}

class Review {
  private version = $state(0)
  readonly kept = new SvelteSet<string>()
  readonly filesDone = new SvelteSet<string>()
  private readonly fading = new SvelteSet<string>()
  listing = $state<string | null>(null)
  sheet = $state.raw<{ thread: Thread; panel: ReviewPanel | null; turn: string | null } | null>(
    null,
  )
  redo = $state.raw<Redo | null>(null)
  said = $state<string | null>(null)
  readonly following = new SvelteSet<string>()

  private readonly landed = new Map<string, { id: string; at: number }>()
  private marked = new WeakSet<NoteDoc>()
  private readonly draw = onceAFrame(() => this.pushMarks())
  private saidTimer: ReturnType<typeof setTimeout> | undefined
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
    onSent(() => this.version++)
    setReviewSource((doc) => this.marksOfDoc(doc))
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

  edits(agents = trackedAgents().filter((one) => providerOf(one) !== null), aside = false): Edit[] {
    this.heard()
    const edits: Edit[] = []
    for (const agent of agents) {
      const away = aside ? tracksAside(agent) : []
      for (const [path, track] of [...tracksOf(agent), ...away]) {
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

  changes(thread: Reviewed, deleted = true): Change[] {
    const agents = thread.helpers?.length ? undefined : providersOf(thread).flatMap(agentsOf)
    return changesOf(thread, this.edits(agents, deleted), answeringAt, this.kept)
  }

  notes(thread: Reviewed): NoteChanges[] {
    return byNote(this.changes(thread, false))
  }

  files(thread: Pick<Thread, 'turns'>): FileChange[] {
    this.heard()
    return fileChangesOf(thread.turns, this.filesDone)
  }

  plan(thread: Thread, turn: string): Plan | null {
    return planFor(thread, turn, this.changes(thread), this.filesDone)
  }

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

  async undo(changes: readonly Edit[], token?: string): Promise<number> {
    const { more, short } = await this.take(changes, token)
    if (more) this.say(more === 1 ? 'and 1 after it' : `and ${more} after it`)
    if (short) saidShort()
    return more
  }

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

  async undoAll(thread: Reviewed & Thread, files: readonly FileChange[]): Promise<void> {
    await this.undoFiles(thread, files)
    await this.undo(this.changes(thread, false))
  }

  keepAll(thread: Reviewed, files: readonly FileChange[]): void {
    this.keep(this.changes(thread))
    this.keepFiles(files)
  }

  keepFiles(files: readonly FileChange[]): void {
    for (const one of files) this.filesDone.add(one.id)
  }

  async undoFiles(thread: Thread, files: readonly FileChange[]): Promise<FileChange[]> {
    const undone: FileChange[] = []
    for (const one of [...files].reverse()) {
      if (!(await undoFile(one, thread))) continue
      this.filesDone.add(one.id)
      undone.unshift(one)
    }
    return undone
  }

  private grouped(changes: readonly Edit[]): [string, Edit[]][] {
    const groups: Record<string, Edit[]> = {}
    for (const change of changes) {
      const now = [...tracksOf(change.agent)].find(([, track]) => track.ids.includes(change.id))
      ;(groups[`${change.agent}\n${now?.[0] ?? change.path}`] ??= []).push(change)
    }
    return Object.entries(groups)
  }

  private heard(): number {
    return this.version
  }

  private say(words: string): void {
    this.said = words
    clearTimeout(this.saidTimer)
    this.saidTimer = setTimeout(() => (this.said = null), 3000)
  }

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

  toggleFollow(thread: Pick<Thread, 'id'>): void {
    if (this.following.has(thread.id)) this.following.delete(thread.id)
    else this.following.add(thread.id)
  }

  private landedMoved(agent: string, was: string, path: string): void {
    const seen = this.landed.get(`${agent}\n${was}`)
    if (!seen) return
    this.landed.delete(`${agent}\n${was}`)
    this.landed.set(`${agent}\n${path}`, seen)
  }

  private follow(agent: string, path: string): void {
    const provider = providerOf(agent)
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

  private pushMarks(): void {
    for (const note of workspace.documents) {
      const marks = this.marksOf(keyOf(note))
      if (!marks.length && !this.marked.has(note)) continue
      note.live.announce([setReviewMarks.of(marks)])
      if (marks.length) this.marked.add(note)
      else this.marked.delete(note)
    }
  }

  openRewind(thread: Thread, panel: ReviewPanel | null, turn: string | null = null): void {
    this.listing = null
    this.sheet = { thread, panel, turn }
  }

  closeRewind(): void {
    this.sheet = null
  }

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
          this.filesDone.add(step.made.id)
          taken.push({ kind: 'made', id: step.made.id, ...gone })
        }
      }
    }
    return { taken, short }
  }

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

  canRedo(thread: Pick<Thread, 'id'> | null): boolean {
    return !!thread && this.redo?.thread === thread.id
  }

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

  private async doAgain(one: Taken, thread: Thread): Promise<boolean> {
    if (one.kind === 'file') {
      await redoFile(one.file, thread)
      this.filesDone.delete(one.file.id)
      return false
    }
    if (one.kind === 'made') {
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
