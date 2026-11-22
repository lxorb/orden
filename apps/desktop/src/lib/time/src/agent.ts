import type { AgentAnswer } from '@orden/contracts'
import {
  asked,
  type Call,
  done,
  gatedBy,
  judged,
  judgedForWriting,
  maybe,
  need,
  onDisk,
  placeOf,
  Refused,
  text,
  type Verb,
  verbsOf,
  writableAt,
} from '../../agent-verbs/src/api'
import { writeIfAbsent } from '../../file-writes/src/api'
import { timeOn } from '../../gates/src/api'
import { fileBytes, nameOf } from '../../platform/src/api'
import { protection } from '../../protect/src/api'
import { readTint } from '../../ui-kit/src/api'
import { placesOf } from './counted'
import { endOf, piecesIn, type Range, startOf } from './days'
import { healthSum, MEASURES, type Measure } from './health'
import { gatherFiles } from './health-import'
import { healthStore } from './health-store.svelte'
import { type Activity, type Lane, LANES, type Per, type Span } from './records'
import {
  mergeBlocks,
  moveBlock,
  notSet,
  placeBlock,
  rangeTotals,
  removeBlock,
  resizeBlock,
  splitBlock,
  type Write,
} from './schedule'
import { time } from './time.svelte'
import { csvOf, jsonOf, recordsIn } from './written'

export const OPS = {
  time_tracker: ['status', 'start', 'switch', 'stop'],
  time_blocks: ['list', 'add', 'edit', 'move', 'split', 'merge', 'delete', 'fill', 'undo', 'redo'],
  time_activities: ['list', 'create', 'rename', 'recolor', 'archive', 'unarchive', 'delete'],
  time_summary: ['day', 'week', 'month', 'year', 'custom'],
  time_health: ['read'],
  time_files: ['import', 'export'],
  time_settings: ['read', 'write'],
} as const
type Verbs = keyof typeof OPS
const MOST_BLOCKS = 500
const MOST_READINGS = 2000
const MOST_PLACES = 25
const iso = (at: number | null) => (at === null ? null : new Date(at).toISOString())
function opOf<V extends Verbs>(call: Call, verb: V): (typeof OPS)[V][number] {
  const said = verb === 'time_summary' ? (maybe(call, 'range') ?? 'day') : need(call, 'op')
  const found = (OPS[verb] as readonly string[]).find((one) => one === said)
  if (!found) {
    const what = verb === 'time_summary' ? 'range' : 'op'
    throw new Refused('bad_arguments', `${what} is one of ${OPS[verb].join(', ')}`)
  }
  return found as (typeof OPS)[V][number]
}
function momentOf(call: Call, name: string): number | null {
  const value = call.args[name]
  if (value === undefined || value === null || value === '') return null
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
  if (!Number.isFinite(at) || at < 0) throw new Refused('bad_arguments', `${name} is a date and time, as ISO 8601`)
  return at
}
function moment(call: Call, name: string): number {
  const at = momentOf(call, name)
  if (at === null) throw new Refused('bad_arguments', `say ${name}, a date and time as ISO 8601`)
  return at
}
function stretchOf(call: Call, range: Range | 'custom' = 'day'): { from: number; to: number } {
  if (range === 'custom') {
    const from = moment(call, 'from')
    const to = moment(call, 'to')
    if (!(to > from)) throw new Refused('bad_arguments', 'to comes after from')
    return { from, to }
  }
  const from = startOf(range, momentOf(call, 'at') ?? Date.now())
  return { from, to: endOf(range, from) }
}
function listedStretch(call: Call): { from: number; to: number } {
  return momentOf(call, 'from') === null && momentOf(call, 'to') === null
    ? stretchOf(call, 'day')
    : stretchOf(call, 'custom')
}
function activityNamed(call: Call, name = 'activity'): Activity {
  const said = need(call, name)
  const folded = said.toLowerCase()
  const found =
    time.activities.find((one) => one.id === said) ?? time.activities.find((one) => one.name.toLowerCase() === folded)
  if (!found) throw new Refused('not_found', `there is no activity ${said}: time_activities list names them`)
  return found
}
function activityOrNone(call: Call): string | null | undefined {
  if (!('activity' in call.args)) return undefined
  const said = call.args.activity
  if (said === null || said === '') return null
  return activityNamed(call).id
}
const shownActivity = (id: string | null) => {
  const found = time.activity(id)
  return found ? { id: found.id, name: found.name } : null
}
const activityShown = (one: Activity) => ({
  id: one.id,
  name: one.name,
  tint: one.tint,
  icon: one.icon,
  parent: one.parent,
  archived: one.archived,
})
const blockShown = (span: Span) => ({
  id: span.id,
  start: iso(span.start),
  end: iso(span.end),
  activity: shownActivity(span.activity),
  note: span.note,
  tags: span.tags,
  source: span.source,
  place: span.place,
  label: span.label,
  device: span.device,
})
function blockNamed(call: Call, name = 'id'): Span {
  const id = need(call, name)
  const found = time.span(id)
  if (!found) throw new Refused('not_found', `there is no block ${id}: time_blocks list names them`)
  return found
}
async function awake(): Promise<void> {
  await import('./start.svelte')
  await time.minutes(0, 0)
}
async function written(call: Call, writes: readonly Write[], said: string, deleting = false): Promise<AgentAnswer> {
  if (!writes.length) throw new Refused('bad_arguments', 'that changes nothing in the schedule')
  const question = await asked(call, deleting ? 'deleting' : null, said)
  if (question) return question
  time.schedule(writes)
  const touched = writes.flatMap((one) => (one.kind === 'remove' ? [] : [one.span.id]))
  return done({
    changed: touched.flatMap((id) => {
      const span = time.span(id)
      return span ? [blockShown(span)] : []
    }),
    removed: writes.flatMap((one) => (one.kind === 'remove' ? [one.id] : [])),
  })
}
async function tracker(call: Call): Promise<AgentAnswer> {
  await awake()
  const op = opOf(call, 'time_tracker')
  if (op === 'status') {
    return done({
      running: time.running.map((span) => ({
        block: span.id,
        activity: shownActivity(span.activity),
        since: iso(span.start),
      })),
      recording: time.recording,
    })
  }
  if (op === 'stop') {
    if (!time.running.length) return done({ stopped: [] })
    const question = await asked(call, null, 'Stop the timer')
    if (question) return question
    const stopped = time.running.map((span) => span.id)
    time.stop()
    return done({ stopped })
  }
  const activity = op === 'switch' || 'activity' in call.args ? activityNamed(call) : time.latest()[0]
  if (!activity) throw new Refused('bad_arguments', 'say activity: there is none to go on with')
  const question = await asked(call, null, `Start ${activity.name}`)
  if (question) return question
  const span = time.start(activity.id)
  return span ? done(blockShown(span)) : done(null)
}
async function blocks(call: Call): Promise<AgentAnswer> {
  await awake()
  const op = opOf(call, 'time_blocks')
  const now = Date.now()
  const spans = time.spans
  switch (op) {
    case 'list': {
      const { from, to } = listedStretch(call)
      const inside = spans.filter((one) => one.start < to && (one.end ?? now) > from)
      const gaps = notSet(spans, await time.minutes(from, to), from, to, now)
      return done({
        from: iso(from),
        to: iso(to),
        blocks: inside.slice(0, MOST_BLOCKS).map(blockShown),
        more: Math.max(0, inside.length - MOST_BLOCKS),
        not_set: gaps.map((one) => ({ from: iso(one.from), to: iso(one.to) })),
      })
    }
    case 'add': {
      const start = moment(call, 'start')
      const end = moment(call, 'end')
      const activity = activityOrNone(call) ?? null
      const writes = placeBlock(spans, start, end, activity, now)
      const added = writes.at(-1)
      if (added?.kind === 'add') {
        added.span = { ...added.span, note: text(call, 'note') ?? '', tags: tagsOf(call) ?? [] }
      }
      return written(call, writes, `Add a block from ${iso(start)} to ${iso(end)}`)
    }
    case 'edit': {
      const span = blockNamed(call)
      let writes: Write[] = []
      const start = momentOf(call, 'start') ?? span.start
      const end = momentOf(call, 'end') ?? span.end
      if (start !== span.start || end !== span.end) writes = resizeBlock(spans, span.id, start, end ?? now, now)
      const kept = writes.find((one) => one.kind === 'change' && one.span.id === span.id)
      const base = kept?.kind === 'change' ? kept.span : span
      const activity = activityOrNone(call)
      const note = text(call, 'note')
      const tags = tagsOf(call)
      const next = {
        ...base,
        ...(activity === undefined ? {} : { activity }),
        ...(note === null ? {} : { note }),
        ...(tags === null ? {} : { tags }),
      }
      const rest = writes.filter((one) => one !== kept)
      return written(call, [...rest, { kind: 'change', span: next }], `Change the block at ${iso(span.start)}`)
    }
    case 'move': {
      const span = blockNamed(call)
      return written(
        call,
        moveBlock(spans, span.id, moment(call, 'start'), now),
        `Move the block at ${iso(span.start)}`,
      )
    }
    case 'split': {
      const span = blockNamed(call)
      return written(call, splitBlock(spans, span.id, moment(call, 'at'), now), `Split the block at ${iso(span.start)}`)
    }
    case 'merge': {
      const span = blockNamed(call)
      const other = blockNamed(call, 'other')
      return written(call, mergeBlocks(spans, span.id, other.id, now), `Join two blocks at ${iso(span.start)}`)
    }
    case 'delete': {
      const span = blockNamed(call)
      return written(call, removeBlock(spans, span.id), `Delete the block at ${iso(span.start)}`, true)
    }
    case 'fill': {
      const activity = activityOrNone(call) ?? null
      const { from, to } = listedStretch(call)
      const gaps = notSet(spans, await time.minutes(from, to), from, to, now)
      let held = spans
      const writes: Write[] = []
      for (const gap of gaps) {
        const more = placeBlock(held, gap.from, Math.min(gap.to, now), activity, now)
        writes.push(...more)
        held = [...held, ...more.flatMap((one) => (one.kind === 'add' ? [one.span] : []))]
      }
      return written(call, writes, `Fill ${gaps.length} Not set ${gaps.length === 1 ? 'gap' : 'gaps'}`)
    }
    case 'undo':
    case 'redo': {
      const question = await asked(call, null, op === 'undo' ? 'Undo a schedule change' : 'Redo a schedule change')
      if (question) return question
      const did = op === 'undo' ? time.undoSchedule() : time.redoSchedule()
      return done({ [op === 'undo' ? 'undone' : 'redone']: did })
    }
  }
}
function tagsOf(call: Call): string[] | null {
  const value = call.args.tags
  if (value === undefined || value === null) return null
  if (!Array.isArray(value) || !value.every((one) => typeof one === 'string')) {
    throw new Refused('bad_arguments', 'tags is a list of words')
  }
  return value
}
function tintOf(call: Call): string | null {
  const said = maybe(call, 'tint')
  if (said === null) return null
  const tint = readTint(said)
  if (!tint) throw new Refused('bad_arguments', `${said} is not a tint the tracker knows`)
  return tint
}
async function activities(call: Call): Promise<AgentAnswer> {
  await awake()
  const op = opOf(call, 'time_activities')
  if (op === 'list') return done(time.activities.map(activityShown))
  if (op === 'create') {
    const name = need(call, 'name')
    const question = await asked(call, null, `Make the activity ${name}`)
    if (question) return question
    const parent = maybe(call, 'parent') === null ? null : activityNamed(call, 'parent').id
    return done(activityShown(time.addActivity(name, tintOf(call), parent, maybe(call, 'icon'))))
  }
  const activity = activityNamed(call)
  const change: Partial<Omit<Activity, 'id'>> | null =
    op === 'rename'
      ? { name: need(call, 'name') }
      : op === 'recolor'
        ? { tint: tintOf(call) ?? need(call, 'tint') }
        : op === 'archive' || op === 'unarchive'
          ? { archived: op === 'archive' }
          : null
  const said = {
    rename: `Rename ${activity.name}`,
    recolor: `Recolor ${activity.name}`,
    archive: `Archive ${activity.name}`,
    unarchive: `Bring back ${activity.name}`,
    delete: `Delete the activity ${activity.name}`,
  }[op]
  const question = await asked(call, op === 'delete' ? 'deleting' : null, said)
  if (question) return question
  if (change === null) {
    time.removeActivity(activity.id)
    return done({ deleted: activity.id })
  }
  time.changeActivity(activity.id, change)
  const now = time.activity(activity.id)
  return done(now ? activityShown(now) : null)
}
function topPlaces(spans: readonly Span[], from: number, to: number, now: number, lane: Lane) {
  return placesOf(piecesIn(spans, from, to, now), lane)
    .slice(0, MOST_PLACES)
    .map((one) => ({ key: one.key, name: one.name, minutes: Math.round(one.ms / 60_000) }))
}
async function summary(call: Call): Promise<AgentAnswer> {
  await awake()
  const range = opOf(call, 'time_summary')
  const { from, to } = stretchOf(call, range)
  const now = Date.now()
  const minutes = await time.minutes(from, to)
  const totals = rangeTotals(time.spans, minutes, from, to, now, { untracked: true })
  const [readings, workouts] = await Promise.all([
    healthStore.readings(from, to).catch(() => []),
    healthStore.workouts(from, to).catch(() => []),
  ])
  const active = minutes.reduce((sum, one) => sum + one.active, 0)
  const batteries = minutes.flatMap((one) => (typeof one.battery === 'number' ? [one.battery] : []))
  return done({
    from: iso(from),
    to: iso(to),
    minutes: Math.round(totals.ms / 60_000),
    activities: totals.slices.map((one) => ({
      activity: shownActivity(one.activity),
      minutes: Math.round(one.ms / 60_000),
    })),
    untracked_minutes: Math.round(totals.untracked / 60_000),
    apps: topPlaces(time.spans, from, to, now, 'app'),
    websites: topPlaces(time.spans, from, to, now, 'site'),
    spaces: topPlaces(time.spans, from, to, now, 'space'),
    tabs: topPlaces(time.spans, from, to, now, 'tab'),
    device: {
      active_minutes: Math.round(active / 60),
      minutes_seen: minutes.length,
      battery_low: batteries.length ? batteries.reduce((low, one) => Math.min(low, one)) : null,
      battery_high: batteries.length ? batteries.reduce((high, one) => Math.max(high, one)) : null,
    },
    health: healthSum(readings, workouts, from, to),
  })
}
function measuresOf(call: Call): readonly Measure[] {
  const value = call.args.kinds
  if (value === undefined || value === null) return MEASURES
  const list = Array.isArray(value) ? value : [value]
  const kinds = MEASURES.filter((one) => list.includes(one))
  if (!kinds.length) throw new Refused('bad_arguments', `kinds is any of ${MEASURES.join(', ')}`)
  return kinds
}
async function health(call: Call): Promise<AgentAnswer> {
  opOf(call, 'time_health')
  const { from, to } = listedStretch(call)
  const [readings, workouts] = await Promise.all([
    healthStore.readings(from, to, measuresOf(call)),
    healthStore.workouts(from, to),
  ])
  const every = Math.max(1, Math.ceil(readings.length / MOST_READINGS))
  return done({
    from: iso(from),
    to: iso(to),
    sum: healthSum(readings, workouts, from, to),
    readings: readings
      .filter((_, at) => at % every === 0)
      .map((one) => ({ kind: one.kind, at: iso(one.at), value: one.value })),
    every_nth: every,
    workouts: workouts.map((one) => ({ ...one, start: iso(one.start), end: iso(one.end) })),
  })
}
async function files(call: Call): Promise<AgentAnswer> {
  await awake()
  const op = opOf(call, 'time_files')
  const place = placeOf(call)
  const relative = op === 'import' ? judged(need(call, 'path')) : judgedForWriting(need(call, 'path'))
  const path = onDisk(place, relative)
  if (!protection.agentsMay(path)) throw new Refused('protected', `${relative} is kept from agents`)
  if (op === 'export') {
    writableAt(place, path)
    const csv = /\.csv$/i.test(relative)
    if (!csv && !/\.json$/i.test(relative)) throw new Refused('bad_arguments', 'export to a .json or a .csv path')
    const question = await asked(call, null, `Write the tracked time to ${relative}`)
    if (question) return question
    const words = csv ? csvOf(time.spans, time.activities, Date.now()) : jsonOf(time.everything())
    if (!(await writeIfAbsent(path, words))) throw new Refused('exists', `there is a file at ${relative} already`)
    return done({ path: relative, written: true })
  }
  const bytes = await fileBytes(path).catch(() => null)
  if (!bytes) throw new Refused('no_such_file', `there is nothing at ${relative}`)
  const question = await asked(call, null, `Bring in ${relative}`)
  if (question) return question
  if (/\.json$/i.test(relative)) {
    const records = recordsIn(new TextDecoder().decode(bytes))
    if (!records) throw new Refused('bad_arguments', `${relative} holds no tracked time`)
    return done({ path: relative, records: time.bring(records) })
  }
  if (!/\.(fit|zip)$/i.test(relative)) throw new Refused('bad_arguments', 'import a .fit, a .zip of them, or a .json')
  const got = await gatherFiles([new File([bytes as BlobPart], nameOf(path))])
  await healthStore.keep(got.readings, got.workouts)
  return done({
    path: relative,
    files: got.read,
    failed: got.failed,
    readings: got.readings.length,
    workouts: got.workouts.length,
  })
}
const PERS: readonly Per[] = ['day', 'week']
async function settings(call: Call): Promise<AgentAnswer> {
  await awake()
  const op = opOf(call, 'time_settings')
  const read = () =>
    done({
      recording: time.recording,
      reminding: time.reminding,
      goals: time.goals.map((one) => ({
        activity: shownActivity(one.activity),
        per: one.per,
        minutes: Math.round(one.ms / 60_000),
      })),
      count_as: time.rules.map((one) => ({ lane: one.lane, place: one.place, activity: shownActivity(one.activity) })),
    })
  if (op === 'read') return read()
  const changes: (() => void)[] = []
  const said: string[] = []
  for (const [key, set] of [
    ['recording', (on: boolean) => time.record(on)],
    ['reminding', (on: boolean) => time.remind(on)],
  ] as const) {
    const value = call.args[key]
    if (value === undefined) continue
    if (typeof value !== 'boolean') throw new Refused('bad_arguments', `${key} is true or false`)
    changes.push(() => set(value))
    said.push(`${key} ${value ? 'on' : 'off'}`)
  }
  if ('goal_minutes' in call.args) {
    const activity = activityNamed(call)
    const per = PERS.find((one) => one === (maybe(call, 'per') ?? 'day'))
    if (!per) throw new Refused('bad_arguments', 'per is day or week')
    const minutes = call.args.goal_minutes === null ? null : Number(call.args.goal_minutes)
    if (minutes !== null && !(Number.isFinite(minutes) && minutes >= 0)) {
      throw new Refused('bad_arguments', 'goal_minutes is a number of minutes, or null for none')
    }
    changes.push(() => time.setGoal(activity.id, per, minutes === null ? null : minutes * 60_000))
    said.push(`a goal for ${activity.name}`)
  }
  if ('count_place' in call.args) {
    const lane = LANES.find((one) => one === maybe(call, 'lane'))
    if (!lane) throw new Refused('bad_arguments', `lane is one of ${LANES.join(', ')}`)
    const place = need(call, 'count_place')
    const activity = activityOrNone(call) ?? null
    changes.push(() => time.countAs(lane, place, activity))
    said.push(`what ${place} counts as`)
  }
  if (!changes.length) {
    throw new Refused('bad_arguments', 'say recording, reminding, goal_minutes or count_place to change')
  }
  const question = await asked(call, 'settings', `Change the time tracker: ${said.join(', ')}`)
  if (question) return question
  for (const change of changes) change()
  return read()
}
const gated = (verb: Verb): Verb => gatedBy(() => timeOn(), 'the time tracker is', verb)
export const timeVerbs = verbsOf({
  time_tracker: gated(tracker),
  time_blocks: gated(blocks),
  time_activities: gated(activities),
  time_summary: gated(summary),
  time_health: gated(health),
  time_files: gated(files),
  time_settings: gated(settings),
} satisfies Record<Verbs, Verb>)
