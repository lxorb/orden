import type { Env } from '../../../sync-server/src/api'
import type { HostKind, MachineHost } from '@orden/online'
import { mayCost } from './budget'
import { HetznerHost, setupOf } from './hetzner-host'
import { serviceOf } from './service'

const ORDEND_PORT = 7680
const LINK_URL = 'http://ordend/link'

const BACKSTOP = 20 * 60 * 1000

const LINK_TRIES = 40
const LINK_WAIT = 250

const SMALL_INSTANCE = 'standard-1' as const

export const SECRET = 'secret'

interface Backups {
  intercept(): Promise<void>
  backup(dir: string, name: string): Promise<string>
  restore(record: string): Promise<void>
}

type MakeBackups = (container: Container, ctx: DurableObjectState, env: Env) => Backups

type Egress = 'open' | 'web'

export interface Wiring {
  backups: MakeBackups
  outbound: (ctx: DurableObjectState) => Fetcher
}

let wiring: Wiring | null = null

export function wire(given: Wiring): void {
  wiring = given
}

function egressOf(env: Env): Egress {
  return env.MACHINE_EGRESS === 'web' ? 'web' : 'open'
}

class ContainerHost implements MachineHost {
  private boot: string | null = null
  private backups: Backups | null = null
  private ready = false

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  private get container(): Container {
    const container = this.ctx.container
    if (!container) throw new Error('this object has no container bound')
    return container
  }

  private backupsOf(): Backups {
    if (!wiring) throw new Error('the machines entry did not wire the backups')
    this.backups ??= wiring.backups(this.container, this.ctx, this.env)
    return this.backups
  }

  async start(id: string, image: string, env: Record<string, string>): Promise<void> {
    const container = this.container
    if (!container.running) {
      const egress = egressOf(this.env)
      const common = {
        instance: SMALL_INSTANCE,
        enableInternet: egress === 'open',
        env,
        labels: { machine: id.slice(0, 64) },
      }
      const snapshot = this.boot
      this.boot = null
      if (snapshot) container.start({ ...common, containerSnapshot: { id: snapshot } })
      else container.start({ ...common, image: container.images[image] ?? image })
    }

    try {
      await this.setUp(container)
    } catch (error) {
      await container.destroy()
      throw error
    }
  }

  private async setUp(container: Container): Promise<void> {
    await this.backupsOf().intercept()
    if (egressOf(this.env) === 'web' && wiring) {
      const outbound = wiring.outbound(this.ctx)
      await container.interceptAllOutboundHttp(outbound)
      await container.interceptOutboundHttps('*', outbound)
    }
    await container.setInactivityTimeout(BACKSTOP)
    this.ready = true
  }

  running(): Promise<boolean> {
    return Promise.resolve(this.ctx.container?.running === true)
  }

  async stop(_id: string, grace: number): Promise<void> {
    const container = this.container
    const running = () => container.running
    this.ready = false
    if (!running()) return
    container.signal(15)
    const until = Date.now() + grace
    while (running() && Date.now() < until) await wait(LINK_WAIT)
    if (running()) await container.destroy('stopped')
  }

  async link(_id: string): Promise<WebSocket> {
    if (!this.ready && this.container.running) await this.setUp(this.container)
    const secret = await this.ctx.storage.get<string>(SECRET)
    let last: unknown = null
    for (let tried = 0; tried < LINK_TRIES; tried++) {
      try {
        const answer = await this.container.getTcpPort(ORDEND_PORT).fetch(LINK_URL, {
          headers: { upgrade: 'websocket', authorization: `Bearer ${secret ?? ''}` },
        })
        const socket = answer.webSocket
        if (socket) {
          socket.accept()
          return socket
        }
        last = new Error(`ordend answered ${String(answer.status)}`)
      } catch (error) {
        last = error
      }
      await wait(LINK_WAIT)
    }
    throw last instanceof Error ? last : new Error('ordend did not answer')
  }

  async snapshot(id: string): Promise<string> {
    const made = await this.container.snapshotContainer({ name: id.slice(0, 64) })
    return made.id
  }

  backup(id: string, dir: string): Promise<string> {
    return this.backupsOf().backup(dir, id)
  }

  async restore(_id: string, from: { snapshot?: string; backup?: string }): Promise<void> {
    if (from.snapshot) this.boot = from.snapshot
    if (from.backup) await this.backupsOf().restore(from.backup)
  }

  usage(): Promise<{ cpuS: number; egressBytes: number }> {
    return Promise.resolve({ cpuS: 0, egressBytes: 0 })
  }
}

export class DevHost implements MachineHost {
  constructor(
    private readonly address: string,
    private readonly secret: string,
  ) {}

  static of(env: Env): DevHost | null {
    const address = env.MACHINE_DEV_ORDEND
    if (!address) return null
    const host = new URL(address).hostname
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') return null
    return new DevHost(address, env.MACHINE_DEV_SECRET ?? '')
  }

  start(): Promise<void> {
    return Promise.resolve()
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  running(): Promise<boolean> {
    return Promise.resolve(false)
  }

  async link(): Promise<WebSocket> {
    const answer = await fetch(new URL('/link', this.address), {
      headers: { upgrade: 'websocket', authorization: `Bearer ${this.secret}` },
    })
    const socket = answer.webSocket
    if (!socket) throw new Error(`ordend answered ${String(answer.status)}`)
    socket.accept()
    return socket
  }

  snapshot(): Promise<string> {
    return Promise.resolve('dev')
  }

  backup(): Promise<string> {
    return Promise.reject(new Error('a dev machine keeps no backups'))
  }

  restore(): Promise<void> {
    return Promise.resolve()
  }

  usage(): Promise<{ cpuS: number; egressBytes: number }> {
    return Promise.resolve({ cpuS: 0, egressBytes: 0 })
  }
}

export function hostOf(kind: HostKind, ctx: DurableObjectState, env: Env): MachineHost {
  const dev = DevHost.of(env)
  if (dev) return dev
  if (kind === 'hetzner') {
    const budget = async (monthly: number, currency: string) =>
      await mayCost(env, (await serviceOf(env)).ceiling, Date.now(), monthly, currency)
    return new HetznerHost(env, ctx.storage, setupOf(env, budget))
  }
  return new ContainerHost(ctx, env)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
