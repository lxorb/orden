import { SvelteMap } from 'svelte/reactivity'
import { identifier, invoke, isRecord, log } from '../../platform/src/api'
import type { Tab } from '../../documents/src/api'
import { busy, message } from '../../ui-kit/src/api'
import { type Space, workspace } from '../../workspace/src/api'
import { applyImport } from './apply'
import { arrive } from './arrive'
import { type Carried, carriedBy } from './carry'
import type { FormatId, ImportPlan, Planned } from './plan'
import {
  failing,
  fixPrompt,
  tabName,
  lostRows,
  overall,
  type Phase,
  type Row,
  tallied,
  timeLeft,
  troubleRows,
} from './progress'
import { detect, readAs } from './read'
import type { Source } from './sources'
import { spelledAs } from './spelled'
import { verified } from './verify'

export interface Bring {
  name: string | ((format: FormatId) => string)
  label: string
  where?: string | null
  read: () => Promise<{ sources: Source[] } | { plan: ImportPlan }>
}
export interface Kept {
  id: string
  space: string
  from: string | null
  label: string
  finished: boolean
}
const NOTHING = 'Nothing in there can be read as notes.'
export class ImportRun {
  readonly id = identifier()
  phase = $state<Phase>('reading')
  format = $state<FormatId | null>(null)
  space = $state<Space | null>(null)
  current = $state('')
  done = $state(0)
  total = $state(0)
  rows = $state<Row[]>([])
  error = $state<string | null>(null)
  noAccess = $state(false)
  now = $state(Date.now())
  private phaseAt = Date.now()
  private stopped = false
  private halted = () => this.stopped
  private carried: Carried | null = null
  private tab: Tab | null = null
  private readonly from = workspace.activeSpaceId
  constructor(readonly bring: Bring) {}
  get fraction(): number {
    return overall(this.phase, this.done, this.total)
  }
  get left(): string | null {
    if (this.phase !== 'writing' && this.phase !== 'checking') return null
    return timeLeft(this.now - this.phaseAt, this.total ? this.done / this.total : 0)
  }
  get tally() {
    return tallied(this.rows)
  }
  get remaining(): number {
    return this.phase === 'review' || this.phase === 'checking' ? 0 : Math.max(0, this.total - this.done)
  }
  get prompt(): string {
    return fixPrompt({
      from: this.bring.label,
      where: this.bring.where ?? null,
      space: this.space?.name ?? '',
      rows: this.rows,
    })
  }
  private settled: Promise<void> = Promise.resolve()
  start(): Promise<void> {
    this.settled = this.started()
    return this.settled
  }
  private async started(): Promise<void> {
    const ticking = setInterval(() => {
      this.now = Date.now()
      this.named()
    }, 500)
    try {
      await this.run()
    } catch (error) {
      if (this.halted()) return
      log('warn', `import: ${String(error)}`)
      this.error = message(error, 'That import could not be written.')
      this.noAccess = isRecord(error) && error.noAccess === true
      this.enter('failed')
      if (!this.tab) {
        runs.delete(this.id)
        busy.failed(this.error)
      }
    } finally {
      clearInterval(ticking)
      this.now = Date.now()
    }
  }
  private async run() {
    const read = await this.bring.read()
    const format = 'plan' in read ? read.plan.format : await detect(read.sources)
    this.format = format
    if ('sources' in read && !read.sources.some((one) => !hidden(one.path))) {
      const lost = format ? (await readAs(format, read.sources)).lost : []
      throw new Error([NOTHING, ...lost].join(' '))
    }
    const named = this.bring.name
    await this.land(typeof named === 'string' ? named : named(format ?? 'markdown'))
    if (!format) throw new Error(NOTHING)
    const plan = 'plan' in read ? read.plan : await this.planned(format, read.sources)
    if (this.halted()) return
    const shown = plan.files.some((one) => !one.path.split('/').some((part) => part.startsWith('.')))
    if (!shown) throw new Error([NOTHING, ...plan.lost].join(' '))
    this.rows = [...troubleRows('failed', plan.failed ?? []), ...lostRows(plan.lost)]
    const landed = await this.written(plan)
    if (this.halted()) return
    await this.checked(landed)
    if (this.halted()) return
    this.enter('review')
  }
  private async land(name: string) {
    const space = await workspace.addSpace(name)
    if (!space) throw new Error('That import could not be written.')
    this.space = space
    this.tab = workspace.openUnsaved('import', keptText(this.kept()), tabName('reading', 0, 0))
  }
  private async planned(format: FormatId, sources: Source[]): Promise<ImportPlan> {
    this.carried = await carriedBy(format, sources)
    this.total = sources.length
    const counted = sources.map((source) => {
      let read = false
      const mark = () => {
        if (read) return
        read = true
        this.done += 1
        this.current = source.path
      }
      const unless = () => (this.halted() ? Promise.reject(new Error('The import was cancelled.')) : null)
      return {
        ...source,
        text: () => unless() ?? source.text().then((text) => (mark(), text)),
        bytes: () => unless() ?? source.bytes().then((bytes) => (mark(), bytes)),
      }
    })
    return spelledAs(this.carried?.linkFormat, () => readAs(format, counted))
  }
  private async written(plan: ImportPlan): Promise<[Planned, string][]> {
    const space = this.space
    if (!space) return []
    this.enter('writing', plan.files.length)
    const landed: [Planned, string][] = []
    await applyImport(
      plan,
      { root: space.root, folder: '' },
      {
        stopped: this.halted,
        onLanded: (file, path) => {
          landed.push([file, path])
          this.rows.push({ kind: file.kind === 'note' ? 'notes' : 'files', path: file.path })
          this.current = file.path
        },
        onFailed: (file, why) => this.rows.push({ kind: 'failed', path: file.path, why }),
        onWritten: (done) => (this.done = done),
      },
    )
    return landed
  }
  private async checked(landed: readonly [Planned, string][]) {
    this.enter('checking', landed.length)
    for (const [file, path] of landed) {
      if (this.halted()) return
      this.current = file.path
      const why = await verified(file, path)
      if (why) this.rows = failing(this.rows, file.path, why)
      this.done += 1
    }
  }
  private enter(phase: Phase, total = 0) {
    this.phase = phase
    this.done = 0
    this.total = total
    this.phaseAt = Date.now()
    this.current = ''
    this.named()
    if (phase === 'review') this.tab?.note.replace(keptText(this.kept()), false)
  }
  private named() {
    const tab = this.tab
    if (!tab) return
    const name = tabName(this.phase, this.fraction, this.tally.failed)
    if (tab.name !== name) tab.name = name
  }
  kept(): Kept {
    return {
      id: this.id,
      space: this.space?.id ?? '',
      from: this.from,
      label: this.bring.label,
      finished: this.phase === 'review',
    }
  }
  async complete() {
    if (this.carried) {
      const { carryOver } = await import('./carry-over')
      await carryOver(this.carried)
    }
    const tab = this.tab
    runs.delete(this.id)
    if (tab) workspace.close(tab.id, false)
    if (this.space) await arrive(this.space)
  }
  async cancel() {
    this.stopped = true
    await this.settled
    runs.delete(this.id)
    await removed(this.space?.id ?? null, this.from)
  }
  async again() {
    await this.cancel()
    await startImport(this.bring)
  }
}
const hidden = (path: string) => path.split('/').some((part) => part.startsWith('.'))
const keptText = (kept: Kept) => JSON.stringify(kept)
export function readKept(text: string): Kept | null {
  try {
    const said: unknown = JSON.parse(text)
    if (!said || typeof said !== 'object') return null
    const one = said as Record<string, unknown>
    if (typeof one.id !== 'string' || typeof one.space !== 'string' || typeof one.label !== 'string') return null
    return {
      id: one.id,
      space: one.space,
      label: one.label,
      from: typeof one.from === 'string' ? one.from : null,
      finished: one.finished === true,
    }
  } catch {
    return null
  }
}
export async function removed(space: string | null, from: string | null) {
  if (space) await workspace.deleteSpace(space)
  if (from && from !== space && workspace.spaces.some((one) => one.id === from)) await workspace.showSpace(from)
}
export async function kept(tab: Tab) {
  workspace.close(tab.id, false)
  await workspace.loadTree()
}
export const runs = new SvelteMap<string, ImportRun>()
let running: ImportRun | null = null
export async function startImport(bring: Bring): Promise<void> {
  if (running) return
  const run = new ImportRun(bring)
  runs.set(run.id, run)
  running = run
  try {
    await run.start()
  } finally {
    running = null
  }
}
export async function openAccess() {
  await invoke('open_full_disk_access').catch(() => undefined)
}
