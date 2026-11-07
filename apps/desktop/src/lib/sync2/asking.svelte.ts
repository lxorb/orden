import { mount, untrack } from 'svelte'
import { door } from '@orden/markdown/door'
import type { Excerpt } from '@orden/sync-core/diverge'
import { message, t } from '../i18n.svelte'
import { howFor } from '../new-tab'
import { overlays } from '../overlays'
import { syncMark, undoToastNotice } from '../surfaces.svelte'
import { afterQuiet } from '../timing'
import { workspace } from '../workspace.svelte'
import type { LogRow, SyncStore } from './store'

export interface Side {
  device: string
  at: number
  excerpt: Excerpt
  plane?: string
  file?: { name: string; size: number; picture: string | null }
}

export interface Held {
  id: string
  path: string
  name: string
  mine: Side
  theirs: Side
}

export type HeldAnswer = 'mine' | 'theirs' | 'both'

export interface HeldNotes {
  readonly notes: readonly Held[]
  answer(id: string, answer: HeldAnswer): Promise<string | undefined>
}

export interface Resurrected {
  id: string
  name: string
  device: string
}

interface Unsynced {
  id: string
  name: string
}

export interface EngineEvents {
  resurrected: Resurrected
  unsynced: Unsynced
  file: { id: string; text: string }
  pass: LogRow
  placed: { moved: number }
}

export interface ForeignCopies {
  foreignCopies(): readonly unknown[]
  unsync(): Promise<number>
}

export interface Engine {
  held: HeldNotes
  store: Pick<SyncStore, 'read'>
  copies?: ForeignCopies
  on<T extends keyof EngineEvents>(type: T, listener: (event: EngineEvents[T]) => void): () => void
}

export const QUIET = 1500

class Asking {
  engine = $state.raw<Engine | null>(null)

  answering = $state<HeldAnswer | null>(null)
  wrong = $state<string | null>(null)

  private open = $state<string | null>(null)
  private clear = $state(true)
  private quiet = $state(true)
  private again = $state(0)

  private shut: string | null = null

  readonly held: readonly Held[] = $derived(this.engine?.held.notes ?? [])

  private readonly paths = $derived(new Set(this.held.map((note) => note.path)))

  private readonly here = $derived(
    this.held.find((note) => note.path === workspace.active?.path) ?? null,
  )

  readonly asked: Held | null = $derived(this.here?.id === this.open ? this.here : null)

  isHeld(path: string | null): boolean {
    return path !== null && this.paths.has(path)
  }

  connect(engine: Engine): () => void {
    this.engine = engine
    this.quiet = true

    const typing = afterQuiet(() => (this.quiet = true), QUIET)
    const typed = () => {
      if (this.quiet) this.quiet = false
      typing()
    }
    window.addEventListener('keydown', typed, true)
    this.clear = overlays.depth === 0
    const watching = overlays.watch(() => (this.clear = overlays.depth === 0))
    const heard = engine.on('resurrected', (event) => void resurrected(event))
    const unheard = engine.on('unsynced', (event) => void unsyncedToast(event.name))

    const watched = $effect.root(() => {
      $effect(() => {
        if (this.held.length) untrack(() => void Promise.all([sheet(), syncMark.ask()]))
      })

      let was: string | null = null
      let asked = 0
      $effect(() => {
        const id = this.here?.id ?? null
        const ready = this.clear && this.quiet
        const again = this.again
        untrack(() => {
          this.looked(id, id !== was || again !== asked, ready)
          was = id
          asked = again
        })
      })
    })

    return () => {
      watched()
      heard()
      unheard()
      watching()
      typing.cancel()
      window.removeEventListener('keydown', typed, true)
      this.engine = null
      this.open = null
      this.shut = null
    }
  }

  private looked(id: string | null, fresh: boolean, ready: boolean) {
    if (fresh) {
      this.shut = null
      this.open = null
      this.wrong = null
    }
    if (id !== null && ready && this.open === null && this.shut !== id) this.open = id
  }

  dismiss() {
    this.shut = this.open
    this.open = null
    this.wrong = null
  }

  async revisit(note: Held) {
    this.again++
    await workspace.open(note.path)
  }

  async answer(note: Held, answer: HeldAnswer) {
    const engine = this.engine
    if (!engine || this.answering) return

    this.answering = answer
    this.wrong = null
    try {
      const copy = await engine.held.answer(note.id, answer)
      this.shut = note.id
      if (this.open === note.id) this.open = null
      if (answer === 'both' && copy) await workspace.openRow(copy, howFor('behind'))
    } catch (error) {
      this.wrong = message(error, t('That did not work.'))
    } finally {
      this.answering = null
    }
  }
}

const mounted = door(() =>
  import('./Diverged.svelte').then(({ default: Diverged }) => {
    mount(Diverged, { target: document.body })
  }),
)

function sheet(): Promise<void> {
  if (__EVEN_PLUGIN__) return Promise.resolve()
  return mounted()
}

async function resurrected(event: Resurrected) {
  await undoToastNotice.ask()
  const { back } = await import('./resurrected.svelte')
  back.show(event)
}

export async function unsyncedToast(name: string) {
  if (__EVEN_PLUGIN__) return
  await undoToastNotice.ask()
  const { unsynced } = await import('./unsynced.svelte')
  unsynced.show(name)
}

export const asking = new Asking()
