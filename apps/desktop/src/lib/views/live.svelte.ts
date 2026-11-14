import {
  answer as answered,
  type Answer,
  type Base,
  cellValue,
  type Context,
  type Row,
  type View,
} from '@orden/bases'
import { untrack } from 'svelte'
import { rows as store } from '../rows/rows.svelte'
import { afterQuiet } from '../platform/src/api'
import { toneColour } from './chips'
import { columnsOf } from './columns'
import { contextFor } from './context'
import { guardedAt } from './guard'
import { day } from './day.svelte'
import { nowHere, todayHere } from './days'

export interface Source {
  scope: string | null
  load(): Promise<Base>
  save(next: Base, shown?: Shown): Promise<void>
  path?: string | null
  stranger?: boolean
  fixed?: () => boolean
  self?: () => Row | undefined
  view?: string | undefined
  watch?: (changed: () => void) => () => void
  shown?: () => Shown | undefined
  keep?: (shown: Shown) => void
}

export interface Shown {
  at: number
  typed: string
}

export type Builder =
  | { kind: 'colour' | 'automations' }
  | { kind: 'rollup' | 'button' | 'formula'; column?: string }
  | { kind: 'options' | 'name'; column: string }

const SEARCH_QUIET = 160

export class LiveView {
  base = $state.raw<Base | null>(null)
  #at = $state(0)
  typed = $state('')
  private searched = $state('')
  today = $state(todayHere())
  failed = $state(false)
  rows = $state.raw<readonly Row[]>([])
  builder = $state<Builder | null>(null)
  refused = $state(0)

  private readonly stops: (() => void)[] = []
  private once = false
  private readonly quiet = afterQuiet(() => (this.searched = this.typed.trim()), SEARCH_QUIET)

  fixed = $state(false)

  get writtenAt(): string | null {
    return this.source.path ?? null
  }

  constructor(private readonly source: Source) {
    const shown = source.shown?.()
    if (shown) {
      this.#at = shown.at
      this.typed = shown.typed
      this.searched = shown.typed.trim()
      this.once = true
    }
  }

  get at(): number {
    return this.#at
  }

  set at(at: number) {
    this.#at = at
    this.kept()
  }

  private kept() {
    this.source.keep?.({ at: this.#at, typed: this.typed })
  }

  start(): () => void {
    const scope = this.source.scope ?? undefined
    this.rows = store.shown(scope)
    this.stops.push(
      store.settled(() => {
        this.rows = store.shown(scope)
      }),
      $effect.root(() => {
        $effect(() => {
          const next = store.shown(scope)
          untrack(() => (this.rows = next))
        })
      }),
    )
    if (this.source.watch) this.stops.push(this.source.watch(() => void this.reload()))
    this.daily()
    void this.reload()
    return () => this.stop()
  }

  private stop() {
    for (const stop of this.stops.splice(0)) stop()
    this.quiet.cancel()
  }

  private daily() {
    this.stops.push(
      $effect.root(() => {
        $effect(() => {
          const today = day.today
          untrack(() => (this.today = today))
        })
      }),
    )
  }

  async reload() {
    try {
      const loaded = await this.source.load()
      const base = guardedAt(loaded, this.source.path ?? null, this.source.stranger)
      if (!base) throw new Error('refused')
      this.fixed = this.source.fixed?.() ?? false
      this.base = base
      const named = this.source.view
      const at = named === undefined ? -1 : base.views.findIndex((one) => one.name === named)
      if (at !== -1 && !this.once) this.at = at
      this.once = true
      if (this.at >= base.views.length) this.at = 0
      this.failed = false
    } catch {
      this.failed = true
    }
  }

  readonly view = $derived.by((): View | null => this.base?.views[this.at] ?? null)

  readonly context = $derived.by((): Context =>
    contextFor({
      rows: this.rows,
      today: this.today,
      now: nowHere(),
      this: this.source.self?.(),
      search: this.searched,
    }),
  )

  readonly answer = $derived.by((): Answer | null => {
    const base = this.base
    if (!base) return null
    try {
      return answered(base, this.at, this.rows, this.context)
    } catch {
      return null
    }
  })

  readonly locked = $derived(this.base?.orden.locked === true || this.view?.orden.locked === true)

  colourOf(row: Row): string | null {
    const base = this.base
    const expression = this.view?.orden.colour
    if (!base || !expression) return null
    const tone = cellValue(base, expression, row, this.context)
    return typeof tone === 'string' ? toneColour(tone) : null
  }

  readonly columns = $derived.by((): string[] =>
    this.base ? columnsOf(this.base, this.at, this.rows) : [],
  )

  search(words: string) {
    this.typed = words
    this.kept()
    if (!words.trim()) {
      this.quiet.cancel()
      this.searched = ''
    } else this.quiet()
  }

  async change(next: Base, show?: number): Promise<void> {
    this.base = next
    if (show !== undefined) this.#at = show
    if (this.#at >= next.views.length) this.#at = Math.max(0, next.views.length - 1)
    await this.source.save(next, { at: this.#at, typed: this.typed })
  }
}
