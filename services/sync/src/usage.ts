import {
  daysBetween,
  dayOf,
  USAGE_DAYS_KEPT,
  usageBatchOf,
  type DailyPing,
  type UsageDay,
  type UsageEvent,
} from '@orden/sync-core/usage'
import { Hono } from 'hono'
import { byteLength, newId, now, sha256 } from './crypto'
import { machineOf, within } from './limits'
import { NOT_JSON, TRY_IN_AN_HOUR } from './refused'
import type { Env, Variables } from './types'

const MOST_BYTES = 256 * 1024
const TOO_LARGE = 'a batch is at most 256 KB'

const AN_HOUR = 60 * 60 * 1000
const A_DAY = 24 * AN_HOUR

const FROM_ONE_MACHINE = 60
const ALL_IN_A_DAY = 500_000

const POSTHOG_HOST = 'https://eu.i.posthog.com'
const CAPTURE = `${POSTHOG_HOST}/batch/`

const NOT_FORWARDED = 'usage could not be passed on - try again later'

interface Usage {
  Bindings: Env
  Variables: Variables
}

interface Captured {
  event: string
  distinct_id: string
  timestamp: string
  uuid?: string
  properties: Record<string, unknown>
}

function shared(event: DailyPing | UsageDay): Record<string, unknown> {
  return {
    app_version: event.app.version,
    channel: event.app.channel,
    os: event.system.os,
    ...(event.system.osVersion === undefined ? {} : { os_version: event.system.osVersion }),
    arch: event.system.arch,
    form: event.system.form,
    engine: event.system.engine,
    language: event.language,
    screen: event.screen,
    signed_in: event.signedIn,
    $process_person_profile: false,
    $geoip_disable: true,
  }
}

async function uuidOf(...parts: string[]): Promise<string> {
  const hex = (await sha256(parts.join('\n'))).slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

async function usageEvents(event: UsageDay, timestamp: string): Promise<Captured[]> {
  const base = shared(event)
  const made: [string, string, Record<string, unknown>][] = [
    [
      'active day',
      '',
      {
        notes: event.sizes.notes,
        spaces: event.sizes.spaces,
        tabs: event.sizes.tabs,
      },
    ],
  ]

  for (const [command, ways] of Object.entries(event.commands)) {
    for (const [via, count] of Object.entries(ways)) {
      made.push(['command', `${command}/${via}`, { command, via, count }])
    }
  }
  for (const [feature, minutes] of Object.entries(event.features)) {
    made.push(['feature', feature, { feature, minutes }])
  }
  for (const [kind, minutes] of Object.entries(event.tabs)) {
    made.push(['tab', kind, { kind, minutes }])
  }
  for (const [setting, values] of Object.entries(event.settings)) {
    for (const [value, count] of Object.entries(values)) {
      made.push(['setting changed', `${setting}/${value}`, { setting, value, count }])
    }
  }
  for (const [step, count] of Object.entries(event.onboarding)) {
    made.push(['onboarding step', step, { step, count }])
  }
  for (const [bucket, count] of Object.entries(event.startup)) {
    made.push(['startup', bucket, { bucket, count }])
  }

  return Promise.all(
    made.map(async ([name, key, properties]) => ({
      event: name,
      distinct_id: event.install,
      timestamp,
      uuid: await uuidOf(event.install, event.day, name, key),
      properties: { ...base, ...properties },
    })),
  )
}

async function capturedOf(event: UsageEvent, at: number): Promise<Captured[]> {
  const timestamp =
    event.day === dayOf(at) ? new Date(at).toISOString() : `${event.day}T12:00:00.000Z`
  if (event.kind === 'usage') return usageEvents(event, timestamp)
  return [{ event: 'daily install', distinct_id: newId(), timestamp, properties: shared(event) }]
}

function fresh(event: UsageEvent, today: string): boolean {
  const age = daysBetween(event.day, today)
  return age >= -1 && age <= USAGE_DAYS_KEPT
}

export const usage = new Hono<Usage>()

usage.post('/', async (context) => {
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

  const batch = usageBatchOf(sent)
  if (typeof batch === 'string') return context.json({ error: batch }, 400)

  const env = context.env
  const machine = machineOf(context.req)
  const allowed =
    (machine === null ||
      (await within(env, 'usage-from', await sha256(machine), FROM_ONE_MACHINE, AN_HOUR))) &&
    (await within(env, 'usage', 'all', ALL_IN_A_DAY, A_DAY))
  if (!allowed) return context.json({ error: TRY_IN_AN_HOUR }, 429)

  const at = now()
  const today = dayOf(at)
  const kept = batch.events.filter((one) => fresh(one, today))
  const key = env.POSTHOG_KEY
  if (!key || kept.length === 0) return context.json({ ok: true, taken: kept.length })

  const captured = (await Promise.all(kept.map((one) => capturedOf(one, at)))).flat()
  let answer: Response
  try {
    answer = await fetch(CAPTURE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, batch: captured }),
    })
  } catch {
    return context.json({ error: NOT_FORWARDED }, 503)
  }
  if (!answer.ok) return context.json({ error: NOT_FORWARDED }, 503)

  return context.json({ ok: true, taken: kept.length })
})
