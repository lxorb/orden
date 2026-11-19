import type { Env } from '../../../sync-server/src/api'
import type { MachineHost } from '@orden/online'
import type { Refusal } from '@orden/online/wire'
import { audit, type Named } from './audit'
import { bundleSha } from './bundle'
import { cloudInit, sshKeyOf } from './cloudinit'
import { spentOn } from './budget'
import { Hetzner, HetznerError, type Pricing, type ServerType } from './hetzner'
import { type Access, Tunnels } from './tunnel'

const SERVER_TYPE = 'cx43'
const LOCATIONS: readonly string[] = ['nbg1', 'fsn1']

const LABEL = 'orden-machine'

const LABELS = [LABEL, 'nib-machine']

async function serverOfMachine(hetzner: Hetzner, id: string) {
  for (const key of LABELS) {
    const found = await hetzner.serverLabelled(key, id)
    if (found) return found
  }
  return null
}

export async function firewallOfMachine(hetzner: Hetzner, id: string): Promise<number | null> {
  for (const key of LABELS) {
    const found = await hetzner.firewallLabelled(key, id)
    if (found !== null) return found
  }
  return null
}

const UNAVAILABLE = new Set(['resource_unavailable', 'placement_error', 'unavailable', 'resource_limit_exceeded'])

const LINK_TRIES = 3
const LINK_WAIT = 1000

const SECRET = 'secret'

export class HostRefused extends Error {
  constructor(readonly refusal: Refusal) {
    super(`refused: ${refusal}`)
    this.name = 'HostRefused'
  }
}

export function hetznerMissing(env: Env): string[] {
  const needed: [string, string | undefined][] = [
    ['HETZNER_TOKEN', env.HETZNER_TOKEN],
    ['MACHINE_TUNNEL_TOKEN', env.MACHINE_TUNNEL_TOKEN],
    ['CF_ACCOUNT_ID', env.CF_ACCOUNT_ID],
    ['CF_ZONE_ID', env.CF_ZONE_ID],
  ]
  return needed.filter(([, value]) => !value).map(([name]) => name)
}

export type MayCost = (monthly: number, currency: string) => Promise<boolean>

export interface Setup {
  hetzner: Hetzner
  tunnels: Tunnels
  service: { id: string; secret: string } | null
  access: Access | null
  domain: string
  origin: string
  mayCost: MayCost
  fetcher: typeof fetch
}

export function setupOf(env: Env, mayCost: MayCost): Setup | null {
  if (hetznerMissing(env).length) return null
  const origin = new URL(env.APP_ORIGIN).origin
  return {
    hetzner: new Hetzner(env.HETZNER_TOKEN ?? ''),
    tunnels: new Tunnels(env.MACHINE_TUNNEL_TOKEN ?? '', env.CF_ACCOUNT_ID ?? '', env.CF_ZONE_ID ?? ''),
    service:
      env.MACHINE_ACCESS_ID && env.MACHINE_ACCESS_SECRET
        ? { id: env.MACHINE_ACCESS_ID, secret: env.MACHINE_ACCESS_SECRET }
        : null,
    access:
      env.MACHINE_ACCESS_TEAM && env.MACHINE_ACCESS_AUD
        ? { team: env.MACHINE_ACCESS_TEAM, aud: env.MACHINE_ACCESS_AUD }
        : null,
    domain: machineDomain(env),
    origin,
    mayCost,
    fetcher: (input, init) => fetch(input, init),
  }
}

export function namesOf(id: string, domain: string) {
  const slug = id
    .replace(/^m_/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 40)
  return {
    hostname: `m-${slug}.${domain}`,
    server: `orden-${slug}`,
    tunnel: `orden-machine-${slug}`,
    formerTunnel: `nib-machine-${slug}`,
  }
}

export function machineDomain(env: Env): string {
  return env.MACHINE_DOMAIN ?? new URL(env.APP_ORIGIN).hostname
}

export function isMachineHost(hostname: string, domain: string): boolean {
  const escaped = domain.toLowerCase().replaceAll('.', '\\.')
  return new RegExp(`^m-[0-9a-f]{32}\\.${escaped}$`).test(hostname.toLowerCase())
}

export function firewallRules(ssh: boolean): unknown[] {
  return ssh
    ? [
        {
          direction: 'in',
          protocol: 'tcp',
          port: '22',
          source_ips: ['0.0.0.0/0', '::/0'],
          description: 'the owner’s emergency SSH key',
        },
      ]
    : []
}

interface Row {
  ssh_key: string | null
  size: string
  region: string
}

interface Priced {
  size: string
  price_month: number | null
  price_hour: number | null
  priced_at: number | null
  spent: number
}

function chosenOf(row: { size: string; region: string }) {
  return row.size !== 'small' && row.region !== 'eu' ? row : null
}

export function costOf(type: ServerType, location: string, pricing: Pricing) {
  const price = type.prices.find((one) => one.location === location)
  const ip = pricing.ipv4.get(location)
  return {
    monthly: Math.round(((price?.monthly ?? 0) + (ip?.monthly ?? 0)) * 100) / 100,
    hourly: Math.round(((price?.hourly ?? 0) + (ip?.hourly ?? 0)) * 10_000) / 10_000,
  }
}

const specOf = (type: ServerType) => JSON.stringify({ cores: type.cores, memory: type.memory, disk: type.disk })

export class HetznerHost implements MachineHost {
  readonly alwaysOn = true

  constructor(
    private readonly env: Env,
    private readonly storage: Pick<DurableObjectStorage, 'get'>,
    private readonly setup: Setup | null,
  ) {}

  private need(): Setup {
    if (this.setup) return this.setup
    throw new Error(`Hetzner machines are not set up: ${hetznerMissing(this.env).join(', ')} missing`)
  }

  private names(id: string) {
    return namesOf(id, this.need().domain)
  }

  async start(id: string, _image: string, env: Record<string, string>): Promise<void> {
    const setup = this.need()
    const names = this.names(id)

    const tunnel = (await setup.tunnels.found(names.formerTunnel)) ?? (await setup.tunnels.tunnel(names.tunnel))
    await setup.tunnels.route(tunnel, names.hostname, setup.access)
    await setup.tunnels.hostname(names.hostname, tunnel)

    const found = await serverOfMachine(setup.hetzner, id)
    if (found) {
      if (found.status === 'off') await setup.hetzner.powerOn(found.id)
      await this.record(id, {
        server_id: found.id,
        server_status: found.status === 'off' ? 'starting' : found.status,
      })
      return
    }

    const secret = env.ORDEND_SECRET
    const bundle = await bundleSha()
    if (!secret) throw new Error('no link secret for the new server')
    if (!bundle) throw new Error('this Worker carries no machine bundle')

    const row = await this.env.DB.prepare('select ssh_key, size, region from machines where id = ?')
      .bind(id)
      .first<Row>()
    const sshKey = row?.ssh_key ? sshKeyOf(row.ssh_key) : null
    const chosen = row ? chosenOf(row) : null
    const wanted = chosen?.size ?? SERVER_TYPE
    const asked = chosen ? [chosen.region] : LOCATIONS

    const type = await setup.hetzner.serverType(wanted)
    const places = asked.filter((one) => !type.available.length || type.available.includes(one))
    const first = places[0]
    if (!first) throw new HetznerError(503, 'resource_unavailable', `no ${wanted} to be had in ${asked.join(' or ')}`)
    const pricing = await setup.hetzner.pricing()
    if (!(await setup.mayCost(costOf(type, first, pricing).monthly, pricing.currency))) throw new HostRefused('budget')

    const firewall =
      (await firewallOfMachine(setup.hetzner, id)) ??
      (await setup.hetzner.createFirewall(names.server, { [LABEL]: id }, firewallRules(sshKey !== null)))
    const userData = cloudInit({
      secret,
      tunnel: await setup.tunnels.tokenOf(tunnel),
      zone: env.TZ ?? 'UTC',
      origin: setup.origin,
      bundle,
      sshKey,
    })

    let last: unknown = null
    for (const location of places) {
      try {
        const made = await setup.hetzner.createServer({
          name: names.server,
          serverType: wanted,
          location,
          userData,
          labels: { [LABEL]: id },
          firewall,
        })
        const place = places.find((one) => one === made.location) ?? location
        const cost = costOf(type, place, pricing)
        await this.record(id, {
          server_id: made.id,
          server_status: made.status,
          region: place,
          size: wanted,
          spec: specOf(type),
          price_month: cost.monthly,
          price_hour: cost.hourly,
          price_currency: pricing.currency,
          priced_at: Date.now(),
          spent: 0,
        })
        await audit(this.env, id, 'server', { detail: place as Named })
        return
      } catch (error) {
        if (!(error instanceof HetznerError) || !UNAVAILABLE.has(error.code)) throw error
        last = error
      }
    }
    throw last instanceof Error ? last : new Error(`no ${wanted} could be made`)
  }

  async resize(id: string, type: string, hard: boolean): Promise<boolean> {
    const setup = this.need()
    const server = await serverOfMachine(setup.hetzner, id)
    if (!server) throw new Error('the machine has no server')
    try {
      if (server.type === type) {
        await this.priced(id, type, server.location)
        if (server.status === 'off') await setup.hetzner.powerOn(server.id)
        return server.status === 'running'
      }
      if (server.status === 'running') await setup.hetzner.shutdown(server.id, hard)
      if (server.status === 'off') await setup.hetzner.changeType(server.id, type)
      return false
    } catch (error) {
      if (error instanceof HetznerError && error.code === 'locked') return false
      throw error
    }
  }

  private async priced(id: string, size: string, location: string): Promise<void> {
    const had = await this.env.DB.prepare(
      'select size, price_month, price_hour, priced_at, spent from machines where id = ?',
    )
      .bind(id)
      .first<Priced>()
    if (!had || had.size === size) return
    const { hetzner } = this.need()
    const [type, pricing] = await Promise.all([hetzner.serverType(size), hetzner.pricing()])
    const cost = costOf(type, location, pricing)
    const at = Date.now()
    await this.record(id, {
      size,
      spec: specOf(type),
      price_month: cost.monthly,
      price_hour: cost.hourly,
      price_currency: pricing.currency,
      spent: spentOn(had, at) ?? 0,
      priced_at: at,
    })
    await audit(this.env, id, 'resize', { detail: size as Named })
  }

  private async record(id: string, fields: Record<string, string | number>): Promise<void> {
    const entries = Object.entries(fields)
    const sets = entries.map(([key], at) => `${key} = ?${String(at + 2)}`).join(', ')
    await this.env.DB.prepare(`update machines set ${sets} where id = ?1`)
      .bind(id, ...entries.map(([, value]) => value))
      .run()
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  async running(id: string): Promise<boolean> {
    if (!this.setup) return false
    const server = await serverOfMachine(this.setup.hetzner, id)
    return server?.status === 'running'
  }

  async link(id: string): Promise<WebSocket> {
    const setup = this.need()
    const secret = await this.storage.get<string>(SECRET)
    const url = `https://${this.names(id).hostname}/link`
    const headers: Record<string, string> = {
      upgrade: 'websocket',
      authorization: `Bearer ${secret ?? ''}`,
    }
    if (setup.service) {
      headers['cf-access-client-id'] = setup.service.id
      headers['cf-access-client-secret'] = setup.service.secret
    }
    let last: unknown = null
    for (let tried = 0; tried < LINK_TRIES; tried++) {
      if (tried) await wait(LINK_WAIT)
      try {
        const answer = await setup.fetcher(url, { headers })
        const socket = answer.webSocket
        if (socket) {
          socket.accept()
          return socket
        }
        last = new Error(`ordend answered ${String(answer.status)}`)
        if (answer.status === 401 || answer.status === 403) break
      } catch (error) {
        last = error
      }
    }
    throw last instanceof Error ? last : new Error('ordend did not answer')
  }

  snapshot(): Promise<string> {
    return Promise.reject(new Error('a machine that is always on keeps its own disk'))
  }

  backup(): Promise<string> {
    return Promise.reject(new Error('a machine that is always on keeps its own disk'))
  }

  restore(): Promise<void> {
    return Promise.resolve()
  }

  usage(): Promise<{ cpuS: number; egressBytes: number }> {
    return Promise.resolve({ cpuS: 0, egressBytes: 0 })
  }

  async reboot(id: string): Promise<void> {
    const setup = this.need()
    const server = await serverOfMachine(setup.hetzner, id)
    if (!server) throw new Error('the machine has no server')
    await setup.hetzner.reset(server.id)
    await this.record(id, { server_status: 'starting' })
  }

  async remove(id: string): Promise<void> {
    if (!this.setup) return
    const { hetzner, tunnels } = this.setup
    const names = this.names(id)
    const server = await serverOfMachine(hetzner, id)
    if (server) await hetzner.deleteServer(server.id)
    const firewall = await firewallOfMachine(hetzner, id)
    if (firewall !== null) await deleteWhenFree(hetzner, firewall)
    await tunnels.remove(names.tunnel, names.hostname)
    await tunnels.remove(names.formerTunnel, names.hostname)
  }
}

async function deleteWhenFree(hetzner: Hetzner, id: number): Promise<void> {
  for (let tried = 0; ; tried++) {
    try {
      await hetzner.deleteFirewall(id)
      return
    } catch (error) {
      const busy = error instanceof HetznerError && error.code === 'resource_in_use'
      if (!busy || tried >= 4) throw error
      await wait(2000)
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
