import type { AgentAnswer, AgentCaller } from '@orden/contracts'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { fitBytes, fitSeconds } from '../test/fit-maker'
import type { Reading, Workout } from './health'

const disk = new Map<string, Uint8Array>()
const written = new Map<string, string>()
const kept: { readings: Reading[]; workouts: Workout[] } = { readings: [], workouts: [] }
let answer: unknown = { status: 'ok' }
vi.mock('./start.svelte', () => ({}))
vi.mock('../../gates/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../gates/src/api')>()),
  timeOn: () => true,
}))
vi.mock('./health-store.svelte', () => ({
  healthStore: {
    readings: (from: number, to: number) =>
      Promise.resolve(kept.readings.filter((one) => one.at >= from && one.at < to)),
    workouts: () => Promise.resolve(kept.workouts),
    keep: (readings: Reading[], workouts: Workout[]) => {
      kept.readings.push(...readings)
      kept.workouts.push(...workouts)
      return Promise.resolve()
    },
  },
}))
vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  fileBytes: (path: string) => {
    const bytes = disk.get(path)
    return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('gone'))
  },
  invoke: () => Promise.resolve(answer),
}))
vi.mock('../../file-writes/src/api', () => ({
  writeIfAbsent: (path: string, words: string) => {
    if (written.has(path)) return Promise.resolve(false)
    written.set(path, words)
    return Promise.resolve(true)
  },
}))
vi.mock('../../agent-verbs/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agent-verbs/src/api')>()),
  placeOf: () => ({ space: { id: 'notes', name: 'Notes', root: '/notes' }, open: true }),
  writableAt: () => undefined,
}))
const { OPS, timeVerbs } = await import('./agent')
const { time } = await import('./time.svelte')
const { TimeStore } = await import('./store.svelte')
const { onViewSlip } = await import('../../agent-verbs/src/api')

const READER: AgentCaller = { agent: null }
const CONFIRMING: AgentCaller = {
  agent: {
    id: 'claude',
    builtIn: false,
    name: 'Claude',
    scopes: ['time' as const],
    spaces: 'all' as const,
    mode: 'confirm' as const,
    programs: [],
    sites: {},
  },
}
const H = 3_600_000
const M = 60_000
const DAY = Date.UTC(2026, 10, 20)
async function run(verb: string, args: Record<string, unknown>, caller = READER) {
  const one = timeVerbs[verb]
  if (!one) throw new Error(`no verb ${verb}`)
  return (await one(verb, args, caller)) as AgentAnswer & { result?: Record<string, unknown> }
}
async function result<T = Record<string, unknown>>(verb: string, args: Record<string, unknown>): Promise<T> {
  const said = await run(verb, args)
  if (!said.ok || said.status !== 'ok') throw new Error(JSON.stringify(said))
  return said.result as T
}
const iso = (at: number) => new Date(at).toISOString()
vi.useFakeTimers({ now: DAY + 2 * 24 * H, toFake: ['Date'] })
const slips: string[] = []
onViewSlip((verb) => slips.push(verb))
beforeEach(() => {
  answer = { status: 'ok' }
})
describe('every user action in the time tracker has an agent verb', () => {
  const BY_VERB: Record<string, string> = {
    activity: 'time_activities list',
    addActivity: 'time_activities create',
    changeActivity: 'time_activities rename, recolor, archive, unarchive',
    removeActivity: 'time_activities delete',
    span: 'time_blocks list',
    addSpan: 'time_blocks add',
    changeSpan: 'time_blocks edit',
    removeSpan: 'time_blocks delete',
    start: 'time_tracker start, switch',
    schedule: 'time_blocks add, edit, move, split, merge, delete, fill',
    undoSchedule: 'time_blocks undo',
    redoSchedule: 'time_blocks redo',
    stop: 'time_tracker stop',
    record: 'time_settings write',
    minutes: 'time_summary day, week, month, year, custom',
    remind: 'time_settings write',
    goalFor: 'time_settings read',
    setGoal: 'time_settings write',
    everything: 'time_files export',
    bring: 'time_files import',
    ruleFor: 'time_settings read',
    countAs: 'time_settings write',
    latest: 'time_tracker start',
    running: 'time_tracker status',
    activities: 'time_activities list',
    spans: 'time_blocks list',
    rules: 'time_settings read',
    recording: 'time_settings read',
    goals: 'time_settings read',
    reminding: 'time_settings read',
  }
  const NOT_THE_READERS = [
    'constructor',
    'ready',
    'kept',
    'opened',
    'switchTo',
    'carry',
    'shown',
    'hear',
    'shownAfter',
    'spansChanged',
    'written',
    'write',
    'put',
    'keepMinutes',
    'exchange',
    'exchanged',
  ]
  const OTHER_DOORS: Record<string, Record<string, string>> = {
    './commands': { startTimer: 'time_tracker start', stopTimer: 'time_tracker stop' },
    './edit': { edited: 'time_blocks edit', undone: 'time_blocks undo, redo' },
    './keeping': { exportCsv: 'time_files export', exportJson: 'time_files export', importJson: 'time_files import' },
    './health-import': {
      gather: 'time_files import',
      gatherFiles: 'time_files import',
      perMinute: 'time_files import',
    },
  }
  const known = (said: string) => {
    const [verb = '', ...rest] = said.split(' ')
    const list = (OPS as Record<string, readonly string[]>)[verb]
    return (
      list !== undefined &&
      rest
        .join(' ')
        .split(', ')
        .every((op) => list.includes(op))
    )
  }
  test('each thing the store does for the reader is a verb and an op the agent has', () => {
    const methods = Object.getOwnPropertyNames(TimeStore.prototype)
    const store = new TimeStore()
    for (const name of methods) {
      expect(name in BY_VERB || NOT_THE_READERS.includes(name), `TimeStore.${name} has no agent verb`).toBe(true)
    }
    for (const [name, said] of Object.entries(BY_VERB)) {
      expect(methods.includes(name) || Object.hasOwn(store, name), name).toBe(true)
      expect(known(said), `${name}: ${said}`).toBe(true)
    }
  })
  test('each door the tracker opens outside the store is a verb and an op too', async () => {
    for (const [path, doors] of Object.entries(OTHER_DOORS)) {
      const module = (await import(/* @vite-ignore */ path)) as Record<string, unknown>
      for (const name of Object.keys(module)) {
        expect(name in doors, `${path} ${name} has no agent verb`).toBe(true)
      }
      for (const said of Object.values(doors)) expect(known(said), said).toBe(true)
    }
  })
  test('each verb is registered with every op it says it has', () => {
    expect(Object.keys(timeVerbs).sort()).toEqual(Object.keys(OPS).sort())
  })
})
describe('an agent at the time tracker', () => {
  test('makes, renames, recolors, archives and deletes activities', async () => {
    const uni = await result<{ id: string }>('time_activities', { op: 'create', name: 'Uni' })
    await result('time_activities', { op: 'create', name: 'Gym', tint: 'green' })
    expect(await result('time_activities', { op: 'rename', activity: 'uni', name: 'Study' })).toMatchObject({
      id: uni.id,
      name: 'Study',
    })
    expect(await result('time_activities', { op: 'recolor', activity: 'Study', tint: 'blue' })).toMatchObject({
      tint: 'blue',
    })
    expect(await result('time_activities', { op: 'archive', activity: uni.id })).toMatchObject({ archived: true })
    expect(await result('time_activities', { op: 'unarchive', activity: uni.id })).toMatchObject({ archived: false })
    expect(await run('time_activities', { op: 'recolor', activity: 'Study', tint: 'plaid' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(await result('time_activities', { op: 'delete', activity: 'Gym' })).toMatchObject({
      deleted: expect.any(String),
    })
    expect((await result<{ name: string }[]>('time_activities', { op: 'list' })).map((one) => one.name)).toEqual([
      'Study',
    ])
  })
  test('starts, switches and stops the timer, and says what runs', async () => {
    await result('time_activities', { op: 'create', name: 'Reading' })
    expect(await result('time_tracker', { op: 'start', activity: 'Study' })).toMatchObject({
      activity: { name: 'Study' },
    })
    await result('time_tracker', { op: 'switch', activity: 'Reading' })
    expect(await result('time_tracker', { op: 'status' })).toMatchObject({
      running: [{ activity: { name: 'Reading' } }],
    })
    await result('time_tracker', { op: 'stop' })
    expect(await result('time_tracker', { op: 'status' })).toMatchObject({ running: [] })
  })
  test('adds, edits, moves, splits, merges and deletes blocks, and undoes', async () => {
    const at = (hours: number) => iso(DAY + hours * H)
    const add = await result<{ changed: { id: string }[] }>('time_blocks', {
      op: 'add',
      start: at(9),
      end: at(10),
      activity: 'Study',
      note: 'chapter 3',
    })
    const id = add.changed[0]?.id ?? ''
    await result('time_blocks', { op: 'edit', id, end: at(11), tags: ['exam'] })
    expect(time.span(id)).toMatchObject({ end: DAY + 11 * H, note: 'chapter 3', tags: ['exam'] })
    await result('time_blocks', { op: 'move', id, start: at(13) })
    expect(time.span(id)).toMatchObject({ start: DAY + 13 * H, end: DAY + 15 * H })
    const split = await result<{ changed: { id: string }[] }>('time_blocks', { op: 'split', id, at: at(14) })
    const halves = split.changed.map((one) => one.id)
    expect(halves).toHaveLength(2)
    await result('time_blocks', { op: 'merge', id: halves[0], other: halves[1] })
    const listed = await result<{ blocks: { id: string; start: string; end: string }[] }>('time_blocks', {
      op: 'list',
      from: at(0),
      to: at(24),
    })
    expect(listed.blocks.map((one) => [one.start, one.end])).toEqual([[at(13), at(15)]])
    const left = listed.blocks[0]?.id ?? ''
    await result('time_blocks', { op: 'delete', id: left })
    expect(time.span(left)).toBeNull()
    expect(await result('time_blocks', { op: 'undo' })).toEqual({ undone: true })
    expect(time.span(left)).not.toBeNull()
  })
  test('fills the Not set gaps of a stretch with an activity', async () => {
    const from = DAY + 20 * H
    const minutes = Array.from({ length: 30 }, (_, at) => ({
      at: from + at * M,
      active: 60,
      samples: 12,
      lid: false,
      locked: false,
    }))
    const spy = vi.spyOn(time, 'minutes').mockResolvedValue(minutes)
    const filled = await result<{ changed: unknown[] }>('time_blocks', {
      op: 'fill',
      activity: 'Reading',
      from: iso(from),
      to: iso(from + 2 * H),
    })
    expect(filled.changed).toHaveLength(1)
    expect(
      time.spans.some(
        (one) => one.start === from && one.activity === time.activities.find((a) => a.name === 'Reading')?.id,
      ),
    ).toBe(true)
    spy.mockRestore()
  })
  test('reads a summary of a day: activities, untracked time, places and health', async () => {
    const said = await result<{ activities: { activity: { name: string } | null; minutes: number }[] }>(
      'time_summary',
      {
        range: 'day',
        at: iso(DAY + 12 * H),
      },
    )
    expect(said.activities).toContainEqual({ activity: { id: expect.any(String), name: 'Study' }, minutes: 120 })
    expect(said).toMatchObject({ apps: [], websites: [], health: expect.any(Object), device: expect.any(Object) })
    expect(await run('time_summary', { range: 'fortnight' })).toMatchObject({ code: 'bad_arguments' })
  })
  test('imports watch data from a FIT file in a space and reads the heart rate back', async () => {
    const at = DAY + 8 * H
    disk.set(
      '/notes/WELLNESS.FIT',
      fitBytes([
        {
          global: 55,
          fields: [
            [253, 4, 0x86],
            [27, 1, 0x02],
          ],
          rows: [
            [fitSeconds(at), 60],
            [fitSeconds(at + M), 70],
          ],
        },
      ]),
    )
    expect(await result('time_files', { op: 'import', path: 'WELLNESS.FIT' })).toMatchObject({ files: 1, failed: [] })
    const read = await result<{ readings: { kind: string; value: number }[] }>('time_health', {
      op: 'read',
      from: iso(DAY),
      to: iso(DAY + 24 * H),
      kinds: ['heart'],
    })
    expect(read.readings.map((one) => one.value)).toEqual([60, 70])
  })
  test('exports the tracked time to a new file, and brings a JSON export in', async () => {
    expect(await result('time_files', { op: 'export', path: 'Time.json' })).toEqual({
      path: 'Time.json',
      written: true,
    })
    expect(await run('time_files', { op: 'export', path: 'Time.json' })).toMatchObject({ code: 'exists' })
    disk.set('/notes/Time.json', new TextEncoder().encode(written.get('/notes/Time.json') ?? ''))
    expect(await result('time_files', { op: 'import', path: 'Time.json' })).toMatchObject({ records: 0 })
    expect(await run('time_files', { op: 'export', path: 'Time.txt' })).toMatchObject({ code: 'bad_arguments' })
  })
  test('changes the tracker settings: recording, reminding, a goal and what a place counts as', async () => {
    const said = await result('time_settings', {
      op: 'write',
      recording: false,
      reminding: false,
      activity: 'Study',
      per: 'week',
      goal_minutes: 600,
    })
    expect(said).toMatchObject({
      recording: false,
      reminding: false,
      goals: [{ activity: { name: 'Study' }, per: 'week', minutes: 600 }],
    })
    await result('time_settings', { op: 'write', lane: 'site', count_place: 'arxiv.org', activity: 'Study' })
    expect(await result('time_settings', { op: 'read' })).toMatchObject({
      count_as: [{ lane: 'site', place: 'arxiv.org', activity: { name: 'Study' } }],
    })
  })
  test('in confirm mode a delete asks first, and nothing goes until it is answered', async () => {
    answer = { status: 'needs_approval', approval: 'a1', summary: 'Delete the activity Reading' }
    expect(await run('time_activities', { op: 'delete', activity: 'Reading' }, CONFIRMING)).toMatchObject({
      status: 'needs_approval',
    })
    expect(time.activities.some((one) => one.name === 'Reading')).toBe(true)
  })
  test('nothing an agent does here moves what the reader sees', () => {
    expect(slips).toEqual([])
  })
})
