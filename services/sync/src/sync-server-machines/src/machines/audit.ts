import type { Env } from '../../../sync-server/src/api'

export type EventKind =
  | 'made'
  | 'start'
  | 'wake'
  | 'sleep'
  | 'stop'
  | 'snapshot'
  | 'backup'
  | 'restore'
  | 'open'
  | 'close'
  | 'typing'
  | 'resume'
  | 'session'
  | 'ended'
  | 'flag'
  | 'release'
  | 'hour'
  | 'failed'
  | 'relink'
  | 'restart'
  | 'reboot'
  | 'host'
  | 'server'

export type Place = 'nbg1' | 'fsn1'

export type Detail =
  | 'idle'
  | 'allowance'
  | 'budget'
  | 'off'
  | 'flag'
  | 'stopped'
  | 'restart'
  | 'account'
  | 'snapshot'
  | 'backup'
  | 'fresh'
  | 'read'
  | 'write'
  | 'owner'
  | 'writers'
  | 'guest'
  | 'running'
  | 'silent'
  | 'cloudflare'
  | 'hetzner'
  | Place
  | Failure
  | number
  | null

export type Failure = string & { readonly failure: unique symbol }

export type Step = 'start' | 'link' | 'restore' | 'backup' | 'snapshot' | 'stop'

const SAID_LIMIT = 160

export function failureOf(step: Step, error: unknown): Failure {
  const named = error instanceof Error ? error : null
  const coded = (error as { code?: unknown } | null)?.code
  const code = typeof coded === 'string' ? coded : null
  const said = (named ? named.message : String(error))
    .replace(/\/home\/nib(\/[^\s'"`]*)?/g, '~')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SAID_LIMIT)
  return [`${step}:`, named?.name ?? typeof error, code, said].filter(Boolean).join(' ') as Failure
}

const KEPT = 90 * 24 * 60 * 60 * 1000

export async function audit(
  env: Env,
  machine: string,
  kind: EventKind,
  who: { who?: string | null; device?: string | null; detail?: Detail } = {},
  at = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    'insert into machine_events (machine, at, kind, who, device, detail) values (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      machine,
      at,
      kind,
      who.who ?? null,
      who.device ?? null,
      who.detail === undefined || who.detail === null ? null : String(who.detail),
    )
    .run()
}

export async function sweepAudit(env: Env, at: number): Promise<void> {
  await env.DB.prepare('delete from machine_events where at < ?')
    .bind(at - KEPT)
    .run()
}
