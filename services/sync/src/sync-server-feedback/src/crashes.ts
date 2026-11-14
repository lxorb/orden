import { Hono, type MiddlewareHandler } from 'hono'
import {
  byteLength,
  type Env,
  equals,
  machineOf,
  NOT_FOUND,
  NOT_JSON,
  now,
  objectBody,
  sha256,
  tokenIn,
  TRY_IN_AN_HOUR,
  type Variables,
  within,
} from '../../sync-server/src/api'
import { crashReportOf, signatureOf, titleOf } from './crash-shape'

const MOST_BYTES = 128 * 1024
const TOO_LARGE = 'a report is at most 128 KB'

const AN_HOUR = 60 * 60 * 1000
const A_DAY = 24 * AN_HOUR
const KEPT = 90 * A_DAY

const FROM_ONE_MACHINE = 30
const ALL_IN_A_DAY = 5000

const BODIES_PER_GROUP = 50

const MOST_LISTED = 200
const LISTED = 50

interface Crashes {
  Bindings: Env
  Variables: Variables
}

interface GroupRow {
  signature: string
  kind: string
  title: string
  first_at: number
  last_at: number
  count: number
  issue_number: number | null
  issue_url: string | null
}

interface ReportRow {
  id: string
  signature: string
  kind: string
  version: string
  platform: string
  created_at: number
  body?: string | null
}

export const crashes = new Hono<Crashes>()

crashes.post('/', async (context) => {
  const said = Number(context.req.header('content-length') ?? '')
  if (Number.isFinite(said) && said > MOST_BYTES) return context.json({ error: TOO_LARGE }, 400)

  const raw = await context.req.text()
  if (byteLength(raw) > MOST_BYTES) return context.json({ error: TOO_LARGE }, 400)

  let sent: unknown
  try {
    sent = JSON.parse(raw)
  } catch {
    return context.json({ error: NOT_JSON }, 400)
  }

  const report = crashReportOf(sent)
  if (typeof report === 'string') return context.json({ error: report }, 400)

  const env = context.env
  const known = await env.DB.prepare('select 1 as here from crash_reports where id = ?')
    .bind(report.id)
    .first()
  if (known) return context.json({ ok: true, id: report.id })

  const machine = machineOf(context.req)
  const allowed =
    (machine === null ||
      (await within(env, 'crash-from', await sha256(machine), FROM_ONE_MACHINE, AN_HOUR))) &&
    (await within(env, 'crashes', 'all', ALL_IN_A_DAY, A_DAY))
  if (!allowed) return context.json({ error: TRY_IN_AN_HOUR }, 429)

  const signature = await signatureOf(report)
  const at = now()

  const added = await env.DB.prepare(
    `insert or ignore into crash_reports (id, signature, kind, version, platform, created_at, body)
       values (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      report.id,
      signature,
      report.kind,
      report.app.version,
      report.system.os,
      at,
      JSON.stringify(report),
    )
    .run()

  if (added.meta.changes > 0) {
    await env.DB.batch([
      env.DB.prepare(
        `insert into crash_groups (signature, kind, title, first_at, last_at, count)
           values (?1, ?2, ?3, ?4, ?4, 1)
           on conflict(signature) do update set
             count = crash_groups.count + 1,
             last_at = max(crash_groups.last_at, excluded.last_at)`,
      ).bind(signature, report.kind, titleOf(report), at),
      env.DB.prepare(
        `update crash_reports set body = null
           where signature = ?1 and body is not null and id not in (
             select id from crash_reports where signature = ?1 and body is not null
               order by created_at desc limit ?2)`,
      ).bind(signature, BODIES_PER_GROUP),
    ])
  }

  return context.json({ ok: true, id: report.id })
})

const reader: MiddlewareHandler<Crashes> = async (context, next) => {
  const kept = context.env.CRASH_READER_TOKEN
  const given = tokenIn(context.req.header('authorization'))
  if (!kept || !given || !equals(await sha256(given), await sha256(kept))) {
    return context.json({ error: NOT_FOUND }, 404)
  }
  await next()
}

function countOf(given: string | undefined, fallback: number, most: number): number {
  const count = Number(given)
  return Number.isInteger(count) && count > 0 ? Math.min(count, most) : fallback
}

function sinceOf(given: string | undefined): number {
  const since = Number(given)
  return Number.isFinite(since) && since > 0 ? since : 0
}

function presentGroup(row: GroupRow, versions: string[], platforms: string[]) {
  return {
    signature: row.signature,
    kind: row.kind,
    title: row.title,
    firstAt: row.first_at,
    lastAt: row.last_at,
    count: row.count,
    versions,
    platforms,
    issue: row.issue_number === null ? null : { number: row.issue_number, url: row.issue_url },
  }
}

function presentReport(row: ReportRow) {
  return {
    id: row.id,
    signature: row.signature,
    kind: row.kind,
    version: row.version,
    platform: row.platform,
    receivedAt: row.created_at,
  }
}

function tally(rows: { signature: string; version: string; platform: string }[]) {
  const seen = new Map<string, { versions: Set<string>; platforms: Set<string> }>()
  for (const row of rows) {
    const one = seen.get(row.signature) ?? { versions: new Set(), platforms: new Set() }
    one.versions.add(row.version)
    one.platforms.add(row.platform)
    seen.set(row.signature, one)
  }
  return (signature: string) => {
    const one = seen.get(signature)
    return {
      versions: [...(one?.versions ?? [])].sort(),
      platforms: [...(one?.platforms ?? [])].sort(),
    }
  }
}

crashes.get('/groups', reader, async (context) => {
  const since = sinceOf(context.req.query('since'))
  const limit = countOf(context.req.query('limit'), LISTED, MOST_LISTED)
  const db = context.env.DB

  const groups = await db
    .prepare(
      `select signature, kind, title, first_at, last_at, count, issue_number, issue_url
         from crash_groups where last_at >= ? order by last_at desc limit ?`,
    )
    .bind(since, limit)
    .all<GroupRow>()

  const spread = await db
    .prepare(
      `select signature, version, platform from crash_reports
         where signature in (
           select signature from crash_groups where last_at >= ?1
             order by last_at desc limit ?2)
         group by signature, version, platform`,
    )
    .bind(since, limit)
    .all<{ signature: string; version: string; platform: string }>()

  const of = tally(spread.results)
  return context.json({
    groups: groups.results.map((row) => {
      const { versions, platforms } = of(row.signature)
      return presentGroup(row, versions, platforms)
    }),
  })
})

crashes.post('/groups/:signature/issue', reader, async (context) => {
  const signature = context.req.param('signature')
  const sent = await objectBody(context)
  const number = sent?.number
  const url = sent?.url
  if (typeof number !== 'number' || !Number.isInteger(number) || number <= 0) {
    return context.json({ error: 'number must be a whole number' }, 400)
  }
  if (typeof url !== 'string' || url.length > 300 || !/^https:\/\/\S+$/.test(url)) {
    return context.json({ error: 'url must be an https address' }, 400)
  }

  const changed = await context.env.DB.prepare(
    'update crash_groups set issue_number = ?, issue_url = ? where signature = ?',
  )
    .bind(number, url, signature)
    .run()
  if (!changed.meta.changes) return context.json({ error: NOT_FOUND }, 404)

  return context.json({ ok: true })
})

crashes.get('/', reader, async (context) => {
  const group = context.req.query('group')
  const limit = countOf(context.req.query('limit'), LISTED, MOST_LISTED)
  const db = context.env.DB

  const listed = group
    ? await db
        .prepare(
          `select id, signature, kind, version, platform, created_at from crash_reports
             where signature = ? order by created_at desc limit ?`,
        )
        .bind(group, limit)
        .all<ReportRow>()
    : await db
        .prepare(
          `select id, signature, kind, version, platform, created_at from crash_reports
             order by created_at desc limit ?`,
        )
        .bind(limit)
        .all<ReportRow>()

  return context.json({ reports: listed.results.map(presentReport) })
})

crashes.get('/:id', reader, async (context) => {
  const id = context.req.param('id')
  const db = context.env.DB
  const row = /^[0-9a-f]{32}$/.test(id)
    ? await db
        .prepare(
          `select id, signature, kind, version, platform, created_at, body
             from crash_reports where id = ?`,
        )
        .bind(id)
        .first<ReportRow>()
    : null
  if (!row) return context.json({ error: NOT_FOUND }, 404)

  const group = await db
    .prepare(
      `select signature, kind, title, first_at, last_at, count, issue_number, issue_url
         from crash_groups where signature = ?`,
    )
    .bind(row.signature)
    .first<GroupRow>()

  const spread = await db
    .prepare(
      'select signature, version, platform from crash_reports where signature = ? group by version, platform',
    )
    .bind(row.signature)
    .all<{ signature: string; version: string; platform: string }>()
  const { versions, platforms } = tally(spread.results)(row.signature)

  return context.json({
    ...presentReport(row),
    report: row.body ? (JSON.parse(row.body) as unknown) : null,
    group: group ? presentGroup(group, versions, platforms) : null,
  })
})

export async function sweepCrashes(env: Env, at: number): Promise<void> {
  await env.DB.prepare('delete from crash_reports where created_at < ?')
    .bind(at - KEPT)
    .run()
}
