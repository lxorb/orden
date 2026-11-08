import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const SYNC = resolve(import.meta.dirname, '../services/sync')
const WRANGLER = join(SYNC, 'node_modules/wrangler/bin/wrangler.js')
const CONFIG = 'wrangler.jsonc'
const ROOM = 512 * 1024 * 1024

export function wrangler(args: string[]): string {
  const done = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: SYNC,
    encoding: 'utf8',
    maxBuffer: ROOM,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
  })
  if (done.error || done.status !== 0) {
    const why = done.error ? String(done.error) : `exit ${done.status ?? done.signal}`
    const said = (done.stdout ?? '').slice(-8000)
    throw new Error(`wrangler ${args.join(' ')}: ${why}\n${done.stderr ?? ''}\n${said}`)
  }
  return done.stdout
}

export function migrateLocal(state: string): string {
  return wrangler([
    'd1',
    'migrations',
    'apply',
    'nib',
    '--local',
    '--persist-to',
    state,
    '--config',
    CONFIG,
  ])
}

export function sqlLocal(state: string, command: string, more: string[] = []): string {
  return wrangler([
    'd1',
    'execute',
    'nib',
    '--local',
    '--persist-to',
    state,
    '--config',
    CONFIG,
    '--command',
    command,
    ...more,
  ])
}

export function rowsLocal(state: string, command: string): Record<string, unknown>[] {
  const said = JSON.parse(sqlLocal(state, command, ['--json'])) as {
    results: Record<string, unknown>[]
  }[]
  return said.flatMap((one) => one.results)
}
