import { isRecord } from '../../stored'
import type { Grant, Minted } from '../verbs'
import type { AgentsCrate, Heard } from './crate'
import { ownGrant, thirdPartyGrant } from './grant'
import { reach } from './reach.svelte'

export function freeId(client: string, taken: readonly string[]): string {
  let stem = ''
  for (const one of client.toLowerCase()) {
    if (/^[a-z0-9]$/.test(one)) stem += one
    else if (stem && !stem.endsWith('-')) stem += '-'
    if (stem.length >= 32) break
  }
  stem = stem.replace(/-+$/, '') || 'agent'
  if (!taken.includes(stem)) return stem

  for (let n = 2; n < 10_000; n++) {
    if (!taken.includes(`${stem}-${n}`)) return `${stem}-${n}`
  }
  return stem
}

const copy = <T>(value: T): T => structuredClone(value)

export class FakeCrate implements AgentsCrate {
  grants: Grant[] = []
  log = new Map<string, unknown[]>()
  path: string | null = 'C:\\Users\\you\\AppData\\Local\\Orden\\orden.exe'
  writes = 0
  failing: Error | null = null
  private listeners = new Set<(event: Heard) => void>()

  private fail(): Promise<void> {
    const failing = this.failing
    this.failing = null
    return failing ? Promise.reject(failing) : Promise.resolve()
  }

  async read(): Promise<Grant[]> {
    await this.fail()
    return copy(this.grants)
  }

  async write(grants: Grant[]): Promise<Grant[]> {
    await this.fail()
    this.writes += 1
    this.grants = grants.flatMap((grant) => {
      const kept = this.grants.find((one) => one.id === grant.id)
      return kept ? [{ ...copy(grant), client: kept.client, created: kept.created }] : []
    })
    return copy(this.grants)
  }

  async mint(name: string): Promise<Minted> {
    await this.fail()
    const trimmed = name.trim()
    if (!trimmed) throw new Error('an agent needs a name')
    const grant = thirdPartyGrant(
      freeId(
        trimmed,
        this.grants.map((one) => one.id),
      ),
      trimmed,
      Date.now(),
    )
    this.grants.push(grant)
    return { grant: copy(grant), token: 'f3a1'.repeat(16) }
  }

  days(): Promise<string[]> {
    return Promise.resolve([...this.log.keys()].sort().reverse())
  }

  day(day: string): Promise<unknown[]> {
    return Promise.resolve(copy(this.log.get(day) ?? []))
  }

  async clear(agent: string | null): Promise<void> {
    await this.fail()
    for (const [day, lines] of this.log) {
      const kept =
        agent === null ? [] : lines.filter((line) => !isRecord(line) || line.agent !== agent)
      if (kept.length) this.log.set(day, kept)
      else this.log.delete(day)
    }
  }

  program(): Promise<string | null> {
    return Promise.resolve(this.path)
  }

  hear(on: (event: Heard) => void): Promise<() => void> {
    this.listeners.add(on)
    return Promise.resolve(() => this.listeners.delete(on))
  }

  emit(event: Heard) {
    for (const one of this.listeners) one(event)
  }

  pair(client: string, at = Date.now()): Grant {
    const grant = ownGrant(
      freeId(
        client,
        this.grants.map((one) => one.id),
      ),
      client,
      at,
    )
    this.grants.push(grant)
    this.emit({ kind: 'answered', agent: grant.id })
    return grant
  }

  called(
    agent: string,
    verb: string,
    at: number,
    args: Record<string, unknown> = {},
    status = 'ok',
    code?: string,
  ) {
    const day = new Date(at).toISOString().slice(0, 10)
    const line = { at, agent, verb, args, status, ms: 12, ...(code ? { code } : {}) }
    this.log.set(day, [...(this.log.get(day) ?? []), line])
  }
}

export function seeded(now = Date.now()): FakeCrate {
  const fake = new FakeCrate()
  const hour = 60 * 60 * 1000
  const claude = fake.pair('Claude Code', now - 20 * 24 * hour)
  const codex = fake.pair('Codex', now - 6 * 24 * hour)
  const codexGrant = fake.grants.find((one) => one.id === codex.id)
  if (codexGrant) {
    codexGrant.scopes = codexGrant.scopes.filter((one) => !one.startsWith('browser'))
  }
  const script = thirdPartyGrant('nightly-backup', 'Nightly backup', now - 2 * 24 * hour)
  fake.grants.push(script)

  const own = fake.grants.find((one) => one.id === claude.id)
  if (own) {
    own.sites = { 'google.com': 'agent-store', 'bank.example': 'deny' }
    own.always = { 'shop.example': ['paying'] }
  }

  const morning = now - 5 * hour
  const calls: [string, Record<string, unknown>, string?][] = [
    ['read_note', { path: 'Research/Trips.md' }],
    ['browser_open', { url: 'https://www.sbb.ch/en' }],
    ['browser_snapshot', { tab: 'a1' }],
    ['browser_type', { tab: 'a1', ref: 'e12', text: 'Zürich HB' }],
    ['browser_click', { tab: 'a1', ref: 'e31' }, 'needs_approval'],
    ['capture_to_note', { tab: 'a1', note: 'Research/Trips.md' }],
    ['edit_note', { path: 'Research/Trips.md' }],
  ]
  calls.forEach(([verb, args, status], at) => {
    fake.called(claude.id, verb, morning + at * 90_000, args, status)
  })
  fake.called(claude.id, 'search_notes', now - 40 * 60_000, { query: 'train times' })
  fake.called(
    claude.id,
    'browser_open',
    now - 39 * 60_000,
    { url: 'https://bank.example/' },
    'error',
    'site_denied',
  )
  fake.called(codex.id, 'read_note', now - 26 * hour, { path: 'Code/Plan.md' })
  return fake
}

export function standIn(fake: FakeCrate = seeded()): FakeCrate {
  reach.standIn = fake
  return fake
}
