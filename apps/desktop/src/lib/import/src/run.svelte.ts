import { SvelteMap } from 'svelte/reactivity'
import { identifier, invoke, isRecord, log, samePath, spaceHolding, within } from '../../platform/src/api'
import type { Tab } from '../../documents/src/api'
import { busy, message } from '../../ui-kit/src/api'
import { type Space, workspace } from '../../workspace/src/api'
import { applyImport } from './apply'
import { arrive } from './arrive'
import { type Carried, carriedBy } from './carry'
import { type Kept, keptText } from './kept'
import type { FormatId, ImportPlan, Planned } from './plan'
import {
  failing,
  fixPrompt,
  lostRows,
  overall,
  type Phase,
  type Row,
  tabName,
  tallied,
  timeLeft,
  troubleRows,
} from './progress'
import { detect, readAs } from './read'
import type { Source } from './sources'
import { spelledAs } from './spelled'
import { takenBack } from './taken-back'
import { verified } from './verify'

interface Told {
  label: string
  title?: string
  where?: string | null
  slug?: string | null
  words?: { notes: string; files: string }
}
export interface Into {
  root: string
  folder: string
  kept?: string
}
export interface Bring extends Told {
  name: string | ((format: FormatId) => string)
  into?: Into
  read: () => Promise<{ sources: Source[] } | { plan: ImportPlan }>
}
export interface Landed {
  made: Space[]
  paths: string[]
  lost: string[]
  later: (() => Promise<void>)[]
}
export interface Landing extends Told {
  land: (landed: Landed) => Promise<Space>
}
export type Brought = Bring | Landing
const NOTHING = 'Nothing in there can be read as notes.'
const SHORTCUT = /\.url$/i
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
  private made: Space[] = []
  private paths: string[] = []
  private later: (() => Promise<void>)[] = []
  private under = ''
  private readonly from = workspace.activeSpaceId
  private settled: Promise<void> = Promise.resolve()
  constructor(readonly bring: Brought) {}
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
      await ('land' in this.bring ? this.landing(this.bring) : this.run(this.bring))
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
  private async run(bring: Bring) {
    const read = await bring.read()
    const format = 'plan' in read ? read.plan.format : await detect(read.sources)
    this.format = format
    if ('sources' in read && !read.sources.some((one) => !hidden(one.path))) {
      const lost = format ? (await readAs(format, read.sources)).lost : []
      throw new Error([NOTHING, ...lost].join(' '))
    }
    const named = bring.name
    if (bring.into) await this.join(bring.into)
    else await this.land(typeof named === 'string' ? named : named(format ?? 'markdown'))
    if (!format) throw new Error(NOTHING)
    const plan = 'plan' in read ? read.plan : await this.planned(format, read.sources)
    if (this.halted()) return
    const shown = plan.files.some((one) => !hidden(one.path))
    if (!shown) throw new Error([NOTHING, ...plan.lost].join(' '))
    this.rows = [...troubleRows('failed', plan.failed ?? []), ...lostRows(plan.lost)]
    const landed = await this.written(plan, bring.into?.folder ?? '')
    if (this.halted()) return
    await this.checked(landed)
    if (this.halted()) return
    this.enter('review')
  }
  private async landing(bring: Landing) {
    const landed: Landed = { made: [], paths: [], lost: [], later: [] }
    const first = await busy.run('Importing', () => bring.land(landed))
    this.made = landed.made
    this.paths = landed.paths
    this.later = landed.later
    if (workspace.activeSpaceId !== first.id) await workspace.showSpace(first.id)
    this.space = first
    this.under = first.root
    this.open()
    this.rows = [
      ...landed.paths.map((path): Row => ({ kind: SHORTCUT.test(path) ? 'notes' : 'files', path: shown(path) })),
      ...lostRows(landed.lost),
    ]
    this.enter('review')
  }
  private async land(name: string) {
    const space = await workspace.addSpace(name)
    if (!space) throw new Error('That import could not be written.')
    this.made = [space]
    this.space = space
    this.under = space.root
    this.open()
  }
  private async join(into: Into) {
    const space = workspace.spaces.find((one) => samePath(one.root, into.root))
    if (!space) throw new Error('That import could not be written.')
    if (workspace.activeSpaceId !== space.id) await workspace.showSpace(space.id)
    this.space = space
    this.under = into.kept ? `${space.root}/${into.kept}` : space.root
    this.open()
  }
  private open() {
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
  private async written(plan: ImportPlan, folder: string): Promise<[Planned, string][]> {
    const space = this.space
    if (!space) return []
    this.enter('writing', plan.files.length)
    const landed: [Planned, string][] = []
    await applyImport(
      plan,
      { root: space.root, folder },
      {
        stopped: this.halted,
        onLanded: (file, path) => {
          landed.push([file, path])
          this.paths.push(path)
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
      made: this.made.some((one) => one.id === this.space?.id),
    }
  }
  async complete() {
    if (this.carried) {
      const { carryOver } = await import('./carry-over')
      await carryOver(this.carried)
    }
    for (const later of this.later) await later()
    const tab = this.tab
    runs.delete(this.id)
    if (tab) workspace.close(tab.id, false)
    if (this.space) await arrive(this.space, !('land' in this.bring))
  }
  async cancel() {
    this.stopped = true
    await this.settled
    runs.delete(this.id)
    const made = this.made
    const elsewhere = this.paths.filter((path) => !spaceHolding(made, path))
    if (elsewhere.length) await takenBack(elsewhere, this.under)
    if (this.tab && !made.some((space) => space.id === this.space?.id)) workspace.close(this.tab.id, false)
    for (const space of made) await workspace.deleteSpace(space.id)
    await back(this.from, made)
  }
  async again() {
    await this.cancel()
    await startImport(this.bring)
  }
}
const hidden = (path: string) => path.split('/').some((part) => part.startsWith('.'))
function shown(path: string): string {
  const space = spaceHolding(workspace.spaces, path)
  return space ? (within(space.root, path) ?? path) : path
}
async function back(from: string | null, made: readonly Space[]) {
  if (!from || made.some((space) => space.id === from)) return
  if (workspace.spaces.some((one) => one.id === from)) await workspace.showSpace(from)
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
export async function startImport(bring: Brought): Promise<void> {
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
