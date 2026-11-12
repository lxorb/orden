import { now } from '../crypto'
import type { Env } from '../types'

const FIRST_V2_APP = '0.12.0'

export const NEEDS_MIN = 'min: the oldest app allowed on v2'

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/

function versionOf(text: string | null | undefined): number[] | null {
  const parts = VERSION.exec((text ?? '').trim())
  if (!parts) return null
  return [
    Number(parts[1]),
    Number(parts[2]),
    Number(parts[3]),
    parts[4] === undefined ? Infinity : Number(parts[4]),
  ]
}

export function atLeastVersion(app: string | null | undefined, min: string): boolean {
  const have = versionOf(app)
  const need = versionOf(min)
  if (!have || !need) return false
  for (let at = 0; at < need.length; at++) {
    const [one, two] = [have[at] ?? 0, need[at] ?? 0]
    if (one !== two) return one > two
  }
  return true
}

export function minimum(given: string | undefined | null): { min: string } | { error: string } {
  const asked = given?.trim() ?? ''
  const min = asked === '' ? FIRST_V2_APP : asked
  if (!versionOf(min)) return { error: 'min is a version like 0.14.0 or 0.13.1-57' }
  if (!atLeastVersion(min, FIRST_V2_APP)) return { error: `min is at least ${FIRST_V2_APP}` }
  return { min }
}

export interface Account {
  id: string
  email: string
  version: 1 | 2
}

export async function accountBy(
  env: Env,
  by: 'email' | 'id',
  value: string,
): Promise<Account | null> {
  const row = await env.DB.prepare(
    `select id, email, sync_version from users where ${by === 'email' ? 'email' : 'id'} = ?`,
  )
    .bind(by === 'email' ? value.trim().toLowerCase() : value)
    .first<{ id: string; email: string; sync_version: number }>()
  return row ? { id: row.id, email: row.email, version: row.sync_version === 2 ? 2 : 1 } : null
}

interface DeviceView {
  id: string
  name: string
  platform: string
  app: string
  lastSeenAt: number | null
  live: boolean
}

interface SessionView {
  id: string
  name: string
  lastUsedAt: number | null
  allowed: boolean
}

interface Blocker {
  kind: 'device' | 'session'
  id: string
  name: string
  app?: string
  why: 'older' | 'unreadable' | 'no device'
}

export interface Standing {
  devices: DeviceView[]
  sessions: SessionView[]
  blockers: Blocker[]
}

export interface Judging {
  min: string
  allow: ReadonlySet<string>
  asker: string | null
  deviceless: 'hold' | 'pass'
}

export async function standing(env: Env, account: Account, judging: Judging): Promise<Standing> {
  const { min, allow, asker, deviceless } = judging
  const at = now()
  const { results: sessions } = await env.DB.prepare(
    `select id, name, last_used_at, token_hash from sessions
      where user_id = ? and expires_at > ? order by last_used_at desc`,
  )
    .bind(account.id, at)
    .all<{ id: string; name: string; last_used_at: number | null; token_hash: string }>()
  const { results: devices } = await env.DB.prepare(
    `select id, name, platform, app, last_seen_at, session_id from devices
      where user_id = ? and revoked_at is null order by last_seen_at desc`,
  )
    .bind(account.id)
    .all<{
      id: string
      name: string
      platform: string
      app: string | null
      last_seen_at: number | null
      session_id: string | null
    }>()

  const live = new Set(sessions.map((one) => one.id))
  const behindDevice = new Set(devices.map((one) => one.session_id))
  const blockers: Blocker[] = []

  const deviceViews = devices.map((one) => {
    const view: DeviceView = {
      id: one.id,
      name: one.name,
      platform: one.platform,
      app: one.app ?? '',
      lastSeenAt: one.last_seen_at,
      live: one.session_id !== null && live.has(one.session_id),
    }
    if (view.live && !allow.has(one.id) && !atLeastVersion(one.app, min)) {
      blockers.push({
        kind: 'device',
        id: one.id,
        name: one.name,
        app: view.app,
        why: versionOf(one.app) ? 'older' : 'unreadable',
      })
    }
    return view
  })

  const sessionViews = sessions
    .filter((one) => !behindDevice.has(one.id) && one.token_hash !== asker)
    .map((one) => {
      const view: SessionView = {
        id: one.id,
        name: one.name,
        lastUsedAt: one.last_used_at,
        allowed: deviceless === 'pass' || allow.has(one.id),
      }
      if (!view.allowed)
        blockers.push({ kind: 'session', id: one.id, name: one.name, why: 'no device' })
      return view
    })

  return { devices: deviceViews, sessions: sessionViews, blockers }
}

export type Mover = 'admin' | 'hello' | 'everyone'

export async function move(
  env: Env,
  account: Account,
  to: 1 | 2,
  why: Mover,
  min: string | null,
): Promise<boolean> {
  const written = await env.DB.prepare(
    'update users set sync_version = ? where id = ? and sync_version = ?',
  )
    .bind(to, account.id, account.version)
    .run()
  if (written.meta.changes === 0) return false

  await env.DB.prepare(
    `insert into sync_flips (user_id, at, from_version, to_version, why, min)
     values (?, ?, ?, ?, ?, ?)`,
  )
    .bind(account.id, now(), account.version, to, why, to === 2 ? min : null)
    .run()
  console.warn(`[sync-version] ${account.id} ${account.version} -> ${to} (${why}, min ${min})`)
  return true
}
