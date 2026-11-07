import { flushTableEdits } from '@orden/editor'
import { freePath } from '@orden/markdown/paths'
import { SAVE_AT_MOST, SAVE_DELAY, saveRetryDelay } from '../backoff'
import { flushCardEdits } from '../canvas/writing'
import { t } from '../i18n.svelte'
import { links } from '../link-index.svelte'
import { log } from '../log'
import { onDisk } from '../on-disk'
import { owesLast, surfacesToWords, writeOwed } from '../parting'
import { movedTo, nameOf, samePath, within } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { afterQuiet } from '../timing'
import { holdsWords, type NoteDoc, type Tab } from './documents.svelte'
import type { FileOp } from './file-ops'
import { isDraft } from './drafts'
import type { Across } from './across'
import type { Status } from '../sync.svelte'

const REFUSALS_TOLD = 3

export interface Writes {
  readonly tabs: Tab[]
  readonly documents: NoteDoc[]
  readonly active: Tab | null
  readonly previewTabId: string | null
  keep(id: string): void
  scheduleSession(): void
  persist(): void
  wroteAll(path: string, key: string, words: string): void
  loadTree(): Promise<void>
  freeName(folder: string, name: string, except?: string): string
  born(path: string): void
  touched(path: string): void
  fileCame(path: string, kind: 'file' | 'folder', key?: string): Promise<void>
  keepPaper(note: NoteDoc, path: string): Promise<void>
}

export const IN_THE_AIR_AT_MOST = 10_000

export class Saving {
  across: Across | null = null

  acrossSoon: (() => Promise<Across>) | null = null

  private readonly soon = afterQuiet(() => void this.saveWaiting(), SAVE_DELAY, SAVE_AT_MOST)

  private failures = 0
  private said: { error: string; was: Status } | null = null
  private readonly retry = afterQuiet(
    () => void this.saveWaiting(),
    () => saveRetryDelay(this.failures),
  )

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly waiting = new Set<NoteDoc>()

  private readonly busy = new WeakMap<NoteDoc, Promise<void>>()

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly held = new Map<NoteDoc, number>()

  private readonly deleted = new WeakSet<NoteDoc>()

  private readonly inTheAir = new WeakMap<NoteDoc, Promise<void>>()

  private readonly overdue = new WeakSet<Promise<void>>()

  private readonly syncMoving = new WeakMap<NoteDoc, Promise<void>>()

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly running = new Set<Promise<void>>()

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly making = new Set<NoteDoc>()

  constructor(private readonly ws: Writes) {
    owesLast(() => this.part())

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('blur', () => this.hurry())
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.hurry()
      })
    }
  }

  private part() {
    this.ws.persist()
    this.hurry()
  }

  edited(note: NoteDoc) {
    const preview = this.ws.tabs.find((tab) => tab.id === this.ws.previewTabId)
    if (preview?.note === note) this.ws.keep(preview.id)

    this.owed(note)
    this.ws.scheduleSession()
  }

  owed(note: NoteDoc) {
    if (note.shared !== null || !holdsWords(note.kind) || isDraft(note)) return

    this.waiting.add(note)
    this.soon()
  }

  flush() {
    for (const note of this.ws.documents) note.flush()
  }

  wordsNow() {
    flushTableEdits()
    flushCardEdits()
    surfacesToWords()
    this.flush()
  }

  replace(text: string, target?: Tab) {
    const note = (target ?? this.ws.active)?.note
    note?.replace(text)
  }

  restoreVersion(text: string, target?: Tab) {
    const note = (target ?? this.ws.active)?.note
    if (!note) return
    note.replace(text)
    note.restoredAt = note.revision
  }

  hurry() {
    if (!this.waiting.size) return

    this.soon.cancel()
    void this.saveWaiting()
  }

  closed(note: NoteDoc) {
    if (this.ws.tabs.some((tab) => tab.note === note)) return

    this.hurry()
  }

  async writeNow(): Promise<void> {
    flushTableEdits()
    flushCardEdits()
    writeOwed()

    const tab = this.ws.active
    if (tab) this.ws.keep(tab.id)

    await this.settled()

    const path = tab?.path ?? null
    if (tab && path !== null && holdsWords(tab.kind) && !tab.note.dirty) {
      await invoke('snapshot_note', { path, content: tab.note.text }).catch(() => undefined)
    }
  }

  get writing(): boolean {
    return this.waiting.size > 0 || this.running.size > 0
  }

  async settled(): Promise<void> {
    for (let round = 0; round < 4; round++) {
      if (this.waiting.size) await this.saveWaiting()
      if (!this.running.size) return

      await Promise.all(this.running)
    }
  }

  private async saveWaiting() {
    const notes = [...this.waiting]
    this.waiting.clear()

    const refused: NoteDoc[] = []
    const unread: NoteDoc[] = []
    await Promise.all(
      notes.map((note) =>
        this.write(note).catch((error: unknown) => {
          refused.push(note)
          this.waiting.add(note)
          if (error instanceof Error && error.name === 'WillNotRead') unread.push(note)
          log('error', `save: ${note.path ?? 'a draft'} - ${String(error)}`)
        }),
      ),
    )

    this.failures = refused.length ? this.failures + 1 : 0
    if (!refused.length) {
      if (this.said) await this.untell()
      return
    }

    this.retry()
    if (this.failures === REFUSALS_TOLD) await this.tell(refused, unread)
  }

  private async tell(refused: readonly NoteDoc[], unread: readonly NoteDoc[]) {
    const first = refused[0]
    if (!first) return

    const { sync } = await import('../sync.svelte')
    const error = unread.includes(first)
      ? t(
          '{name} could not be written: its file can’t be read. It may be over 64 MB or not UTF-8 text.',
          { name: first.shown },
        )
      : t('{name} could not be written.', { name: first.shown })
    this.said = { error, was: sync.status === 'error' ? 'off' : sync.status }
    sync.status = 'error'
    sync.lastError = error
  }

  private async untell() {
    const said = this.said
    this.said = null
    if (!said) return

    const { sync } = await import('../sync.svelte')
    if (sync.status !== 'error' || sync.lastError !== said.error) return
    sync.status = said.was
    sync.lastError = null
  }

  holding(notes: readonly NoteDoc[], run: () => Promise<void>): Promise<void> {
    const before = Promise.all(notes.map((one) => this.busy.get(one) ?? Promise.resolve()))
    const mine = before.then(run)
    for (const one of notes) {
      this.held.set(one, (this.held.get(one) ?? 0) + 1)
      this.busy.set(
        one,
        mine.catch(() => undefined),
      )
    }
    void mine
      .catch(() => undefined)
      .then(() => {
        for (const one of notes) {
          const left = (this.held.get(one) ?? 1) - 1
          if (left) this.held.set(one, left)
          else this.held.delete(one)
        }
      })

    this.track(mine)
    return mine
  }

  holdingUnder(from: string, run: () => Promise<void>): Promise<void> {
    return this.holding(this.under(from), run)
  }

  private under(from: string): NoteDoc[] {
    return [...this.ws.documents, ...this.waiting, ...this.held.keys()].filter(
      (one, at, all) =>
        all.indexOf(one) === at && one.path !== null && within(from, one.path) !== null,
    )
  }

  follow(op: FileOp) {
    if (op.op === 'removed') {
      for (const note of [...this.held.keys(), ...this.waiting, ...this.ws.documents]) {
        if (note.path !== null && within(op.path, note.path) !== null) this.deleted.add(note)
      }
      return
    }
    if (op.op !== 'moved') return
    for (const note of [...this.held.keys(), ...this.waiting]) {
      if (note.path === null || this.ws.documents.includes(note)) continue
      const to = movedTo(note.path, op.from, op.to)
      if (to === null) continue
      note.path = to
      note.name = nameOf(to)
    }
  }

  async holdingWrites<T>(
    from: string,
    run: () => Promise<T>,
    stalled: () => Promise<T>,
  ): Promise<T> {
    const notes = this.under(from)
    let letGo = () => {
      // Replaced the moment the promise below hands over its resolver.
    }
    const moving = new Promise<void>((go) => {
      letGo = () => go()
    })
    for (const one of notes) this.syncMoving.set(one, moving)

    try {
      if (await this.landed(notes)) return await run()
      log('warn', `save: a write under ${from} has not answered, so sync does not move it yet`)
      return await stalled()
    } finally {
      for (const one of notes) if (this.syncMoving.get(one) === moving) this.syncMoving.delete(one)
      letGo()
    }
  }

  private async landed(notes: readonly NoteDoc[]): Promise<boolean> {
    const air = notes.flatMap((one) => this.inTheAir.get(one) ?? [])
    if (!air.length) return true
    if (air.some((one) => this.overdue.has(one))) return false

    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<boolean>((go) => {
      timer = setTimeout(() => go(false), IN_THE_AIR_AT_MOST)
    })
    const inTime = await Promise.race([Promise.all(air).then(() => true), late])
    clearTimeout(timer)
    if (!inTime) for (const one of air) this.overdue.add(one)
    return inTime
  }

  write(note: NoteDoc): Promise<void> {
    return this.holding([note], () => this.writeOne(note))
  }

  private track(work: Promise<void>) {
    const done = work.catch(() => undefined)
    this.running.add(done)
    void done.then(() => this.running.delete(done))
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly claimed = new Set<string>()

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  private readonly claimHeld = new Map<string, () => void>()

  private isClaimed(path: string): boolean {
    return [...this.claimed].some((one) => samePath(one, path))
  }

  async place(note: NoteDoc, folder: string, file: string): Promise<string | null> {
    if (note.path !== null) return null
    const { canWriteAt } = await import('../sharing.svelte')
    if (!canWriteAt(folder)) return null

    const path = await this.claim(note, folder, file)
    if (path === null) return null
    if (note.kind === 'pages') await this.ws.keepPaper(note, path)
    note.name = nameOf(path)
    note.dirty = true
    this.making.add(note)
    this.ws.born(path)

    this.waiting.add(note)
    this.soon.cancel()
    try {
      await this.saveWaiting()
    } finally {
      this.claimed.delete(path)
      this.claimHeld.get(path)?.()
      this.claimHeld.delete(path)
    }
    return path
  }

  private async claim(note: NoteDoc, folder: string, file: string): Promise<string | null> {
    const { pairOf } = await import('../pages/held')
    const { holdIfFree } = await import('../locks')
    const found: string[] = []
    for (;;) {
      const name = freePath(
        file,
        (candidate) =>
          found.includes(candidate) ||
          this.isClaimed(joinPath(folder, candidate)) ||
          this.ws.freeName(folder, candidate) !== candidate,
      )
      const path = joinPath(folder, name)
      const release = await holdIfFree(`orden:claim:${path}`)
      if (release === null) {
        found.push(name)
        continue
      }
      const other = pairOf(name)
      const taken =
        (await onDisk(path)) || (other !== null && (await onDisk(joinPath(folder, other))))
      if (note.path !== null) {
        release()
        return null
      }
      if (taken) found.push(name)
      else if (!this.isClaimed(path) && this.ws.freeName(folder, name) === name) {
        note.path = path
        this.claimed.add(path)
        this.claimHeld.set(path, release)
        return path
      }
      release()
    }
  }

  private gone(note: NoteDoc): boolean {
    return this.deleted.has(note) && !this.ws.tabs.some((tab) => tab.note === note)
  }

  get worthKeeping(): { key: string; path: string; text: string; revision: number }[] {
    this.flush()
    const out: { key: string; path: string; text: string; revision: number }[] = []

    for (const note of this.ws.documents) {
      const path = note.path
      if (path === null || !holdsWords(note.kind)) continue

      out.push({ key: note.key, path, text: note.text, revision: note.revision })
    }

    return out
  }

  private async writeOne(note: NoteDoc): Promise<void> {
    note.flush()

    let path = note.path
    if (path === null || !holdsWords(note.kind)) return

    if (this.gone(note)) return

    const holding = note.arrivals
    const making = this.making.has(note)

    let content = note.text
    const revision = note.revision

    const before = note.firstVersion()
    if (before?.trim() && before !== content) {
      await invoke('snapshot_note', { path, content: before }).catch(() => undefined)
    }

    for (let move = this.syncMoving.get(note); move; move = this.syncMoving.get(note)) await move

    if (note.arrivals !== holding) {
      console.warn(`orden: a write of ${path} was refused - those words are another note’s now`)
      return
    }

    if (note.path !== null) path = note.path

    const across = this.across ?? (await this.acrossSoon?.().catch(() => null)) ?? null
    const writing = path
    const down = (words: string) => invoke('write_note', { path: writing, content: words })
    const landing: Promise<{ words: string; revision: number } | null> = across
      ? across.writing(note, path, down)
      : down(content).then(() => {
          note.onDisk = content
          return { words: content, revision }
        })
    const air: Promise<void> = landing.then(
      () => undefined,
      () => undefined,
    )
    this.inTheAir.set(note, air)
    void air.then(() => {
      if (this.inTheAir.get(note) === air) this.inTheAir.delete(note)
    })
    const landed = await landing
    if (landed === null) return
    content = landed.words
    note.written(path, nameOf(path), landed.revision)
    if (!note.dirty) this.ws.wroteAll(path, note.key, content)
    if (!samePath(note.path, path)) this.owed(note)

    links.noteSaved(path, content)

    if (/\.css$|snippets\.json$/.test(path)) {
      const { settings } = await import('../settings.svelte')
      const { theme } = await import('../theme.svelte')
      await Promise.all([settings.loadSnippets(), theme.reload()])
    }

    if (making) {
      this.making.delete(note)
      await this.ws.loadTree()
      await this.ws.fileCame(path, 'file', note.key)
    } else {
      this.ws.touched(path)
    }
    this.ws.persist()

    const { sync } = await import('../sync.svelte')
    sync.wrote(path, content)
  }
}
