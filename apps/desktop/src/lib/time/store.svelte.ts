import { log } from '../log'
import { afterQuiet } from '../timing'
import { openTimeDisk, type TimeDisk } from './disk'
import { exchange, type TimeServer } from './exchange'
import { Ledger, type Row } from './ledger'
import {
  type Activity,
  activityOf,
  activityValue,
  type Lanes,
  lanesOf,
  LONGEST_NAME,
  type Rule,
  ruleOf,
  ruleValue,
  type Span,
  spanOf,
  spanValue,
} from './records'

const CURSOR = 'cursor'

const SEND_AFTER = 1500

const TRACKING = 'tracking'

export interface Opening {
  owner: string | null
  server: TimeServer | null
  device: string
}

type SpanFields = Partial<Omit<Span, 'id'>>

const byStart = (one: Span, other: Span) =>
  one.start - other.start || one.id.localeCompare(other.id)

const byOrder = (one: Activity, other: Activity) =>
  one.order - other.order || one.name.localeCompare(other.name)

export class TimeStore {
  activities = $state.raw<Activity[]>([])
  spans = $state.raw<Span[]>([])
  rules = $state.raw<Rule[]>([])
  tracking = $state.raw<Lanes>(lanesOf(null))
  ready = $state(false)
  kept = $state<boolean | null>(null)

  readonly running = $derived(this.spans.filter((span) => span.end === null))

  private ledger = new Ledger()
  private disk: TimeDisk | null = null
  private server: TimeServer | null = null
  private owner: string | null | undefined = undefined
  private device = ''
  private cursor = 0
  private opening: Promise<void> = Promise.resolve()
  private exchanging: Promise<void> | null = null
  private again = false

  private readonly sendSoon = afterQuiet(() => void this.exchange(), SEND_AFTER)

  constructor(private readonly open: (owner: string | null) => Promise<TimeDisk> = openTimeDisk) {}

  opened(how: Opening): Promise<void> {
    this.server = how.server
    this.device = how.device
    if (how.owner === this.owner) return this.opening
    this.owner = how.owner
    this.opening = this.opening
      .then(() => this.switchTo(how.owner))
      .catch((error: unknown) => {
        log('warn', `time records did not open: ${String(error)}`)
      })
    return this.opening
  }

  private async switchTo(owner: string | null): Promise<void> {
    const opened = this.disk !== null
    this.disk?.close()
    this.disk = null
    this.ready = false
    const early = opened ? [] : this.ledger.pending(Infinity)
    const disk = await this.open(owner)
    const ledger = new Ledger(await disk.rows())
    const cursor = await disk.read(CURSOR)
    if (owner !== null) await this.carry(ledger, disk)
    await disk.put(early.map((row) => ledger.write(row.kind, row.id, row.value, row.at)))
    this.disk = disk
    this.ledger = ledger
    this.cursor = typeof cursor === 'number' ? cursor : 0
    this.kept = null
    this.shown()
    this.ready = true
    if (this.server) void this.exchange()
  }

  private async carry(into: Ledger, disk: TimeDisk): Promise<void> {
    const local = await this.open(null)
    try {
      const rows = await local.rows()
      if (!rows.length) return
      const carried = rows
        .filter((row) => row.value !== null && !into.get(row.kind, row.id))
        .map((row) => into.write(row.kind, row.id, row.value, row.at))
      await disk.put(carried)
      await local.clear()
    } finally {
      local.close()
    }
  }

  private shown(): void {
    this.activities = this.ledger
      .live('activity')
      .flatMap((row) => (row.value ? [activityOf(row.id, row.value)] : []))
      .filter((one): one is Activity => one !== null)
      .sort(byOrder)
    this.spans = this.ledger
      .live('span')
      .flatMap((row) => (row.value ? [spanOf(row.id, row.value)] : []))
      .filter((one): one is Span => one !== null)
      .sort(byStart)
    this.rules = this.ledger
      .live('rule')
      .flatMap((row) => (row.value ? [ruleOf(row.id, row.value)] : []))
      .filter((one): one is Rule => one !== null)
    this.tracking = lanesOf(this.ledger.get('pref', TRACKING)?.value)
  }

  private written(rows: readonly Row[]): void {
    if (!rows.length) return
    this.shown()
    void this.disk?.put(rows).catch((error: unknown) => {
      log('warn', `time records were not kept: ${String(error)}`)
    })
    if (this.server) this.sendSoon()
  }

  private write(kind: string, id: string, value: Record<string, unknown> | null): Row {
    return this.ledger.write(kind, id, value, Date.now())
  }

  activity(id: string | null): Activity | null {
    return this.activities.find((one) => one.id === id) ?? null
  }

  addActivity(name: string, tint: string | null = null, parent: string | null = null): Activity {
    const activity: Activity = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, LONGEST_NAME),
      tint,
      parent,
      archived: false,
      order: (this.activities.at(-1)?.order ?? 0) + 1,
    }
    this.written([this.write('activity', activity.id, activityValue(activity))])
    return activity
  }

  changeActivity(id: string, change: Partial<Omit<Activity, 'id'>>): void {
    const was = this.activity(id)
    if (!was) return
    const next = { ...was, ...change }
    if (!next.name.trim()) return
    this.written([this.write('activity', id, activityValue(next))])
  }

  removeActivity(id: string): void {
    const rows = [this.write('activity', id, null)]
    for (const rule of this.rules) {
      if (rule.activity === id) rows.push(this.write('rule', rule.id, null))
    }
    for (const span of this.spans) {
      if (span.activity === id)
        rows.push(this.write('span', span.id, spanValue({ ...span, activity: null })))
    }
    this.written(rows)
  }

  span(id: string): Span | null {
    return this.spans.find((one) => one.id === id) ?? null
  }

  addSpan(fields: SpanFields & { start: number }): Span {
    const span: Span = {
      id: crypto.randomUUID(),
      end: null,
      activity: null,
      tags: [],
      note: '',
      source: 'manual',
      space: null,
      site: null,
      label: null,
      device: this.device || null,
      ...fields,
    }
    if (span.end !== null && span.end < span.start) span.end = span.start
    this.written([this.write('span', span.id, spanValue(span))])
    return span
  }

  changeSpan(id: string, change: SpanFields): void {
    const was = this.span(id)
    if (!was) return
    const next = { ...was, ...change }
    if (next.end !== null && next.end < next.start) return
    this.written([this.write('span', id, spanValue(next))])
  }

  removeSpan(id: string): void {
    if (this.span(id)) this.written([this.write('span', id, null)])
  }

  start(activity: string | null, at = Date.now()): Span {
    this.stop(at)
    return this.addSpan({ start: at, end: null, activity, source: 'timer' })
  }

  stop(at = Date.now()): void {
    const rows = this.running.map((span) =>
      this.write('span', span.id, spanValue({ ...span, end: Math.max(at, span.start) })),
    )
    this.written(rows)
  }

  track(change: Partial<Lanes>): void {
    const next = { ...this.tracking, ...change }
    this.written([this.write('pref', TRACKING, { spaces: next.spaces, sites: next.sites })])
  }

  ruleFor(lane: 'space' | 'site', key: string): Rule | null {
    return this.rules.find((one) => (lane === 'space' ? one.space : one.site) === key) ?? null
  }

  countAs(lane: 'space' | 'site', key: string, activity: string | null): void {
    const was = this.ruleFor(lane, key)
    if (activity === null) {
      if (was) this.written([this.write('rule', was.id, null)])
      return
    }
    const rule: Rule = {
      id: was?.id ?? crypto.randomUUID(),
      activity,
      space: lane === 'space' ? key : null,
      site: lane === 'site' ? key : null,
    }
    this.written([this.write('rule', rule.id, ruleValue(rule))])
  }

  latest(): Activity[] {
    const seen: Activity[] = []
    for (const span of [...this.spans].reverse()) {
      const one = this.activity(span.activity)
      if (one && !one.archived && !seen.includes(one)) seen.push(one)
    }
    return [...seen, ...this.activities.filter((one) => !one.archived && !seen.includes(one))]
  }

  exchange(): Promise<void> {
    if (this.exchanging) {
      this.again = true
      return this.exchanging
    }
    this.exchanging = this.exchanged().finally(() => {
      this.exchanging = null
      if (this.again) {
        this.again = false
        void this.exchange()
      }
    })
    return this.exchanging
  }

  private async exchanged(): Promise<void> {
    await this.opening
    const { server, disk, ledger } = this
    if (!server || !disk) return
    try {
      const done = await exchange(ledger, server, this.cursor)
      if (ledger !== this.ledger) return
      this.kept = done.reached
      this.cursor = done.cursor
      await disk.put(done.written)
      await disk.keep(CURSOR, done.cursor)
      if (done.written.length) this.shown()
    } catch (error) {
      log('info', `time records did not reach the account: ${String(error)}`)
    }
  }
}
