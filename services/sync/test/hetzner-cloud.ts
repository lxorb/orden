interface FakeServer {
  id: number
  name: string
  status: string
  location: string
  type: string
  changing?: { to: string; looks: number }
  labels: Record<string, string>
  userData: string
  firewall: number
}
interface FakeType {
  cores: number
  memory: number
  disk: number
  cpu_type: 'shared' | 'dedicated'
  architecture: 'x86' | 'arm'
  monthly: string
  hourly: string
  deprecated?: boolean
}
const TYPES: Record<string, FakeType> = {
  cx23: {
    cores: 2,
    memory: 4,
    disk: 40,
    cpu_type: 'shared',
    architecture: 'x86',
    monthly: '4.7481',
    hourly: '0.0083',
  },
  cx43: {
    cores: 8,
    memory: 16,
    disk: 160,
    cpu_type: 'shared',
    architecture: 'x86',
    monthly: '13.6731',
    hourly: '0.0238',
  },
  cx53: {
    cores: 16,
    memory: 32,
    disk: 320,
    cpu_type: 'shared',
    architecture: 'x86',
    monthly: '27.3581',
    hourly: '0.0476',
  },
  cax31: {
    cores: 8,
    memory: 16,
    disk: 160,
    cpu_type: 'shared',
    architecture: 'arm',
    monthly: '15.4581',
    hourly: '0.0262',
  },
  ccx33: {
    cores: 8,
    memory: 32,
    disk: 240,
    cpu_type: 'dedicated',
    architecture: 'x86',
    monthly: '74.8781',
    hourly: '0.1202',
  },
  cx42: {
    cores: 8,
    memory: 16,
    disk: 160,
    cpu_type: 'shared',
    architecture: 'x86',
    monthly: '19.9900',
    hourly: '0.0320',
    deprecated: true,
  },
}
interface Failure {
  method: string
  path: RegExp
  status: number
  code: string
}
export class Cloud {
  readonly asked: string[] = []
  readonly servers: FakeServer[] = []
  readonly firewalls: {
    id: number
    name: string
    labels: Record<string, string>
    rules: unknown[]
  }[] = []
  readonly tunnels: { id: string; name: string; config: unknown; connections: boolean }[] = []
  readonly records: { id: string; name: string; content: string; proxied: boolean }[] = []
  readonly linked: Headers[] = []
  readonly failures: Failure[] = []
  available = ['nbg1', 'fsn1', 'hel1']
  linkStatus = 101
  changeLooks = 2
  stubborn = false
  private next = 100
  fail(method: string, path: RegExp, status: number, code: string): void {
    this.failures.push({ method, path, status, code })
  }
  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname + url.search
    this.asked.push(
      `${method} ${url.hostname === 'api.hetzner.cloud' ? path.replace('/v1', '') : url.hostname === 'api.cloudflare.com' ? path.replace('/client/v4', '') : url.href}`,
    )
    const failure = this.failures.findIndex((one) => one.method === method && one.path.test(path))
    if (failure >= 0) {
      const [one] = this.failures.splice(failure, 1)
      return Response.json(
        url.hostname === 'api.hetzner.cloud'
          ? { error: { code: one?.code, message: `fake ${one?.code ?? ''}` } }
          : { success: false, errors: [{ code: 1000, message: `fake ${one?.code ?? ''}` }] },
        { status: one?.status ?? 500 },
      )
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    if (url.hostname === 'api.hetzner.cloud') return this.hetzner(method, url, body)
    if (url.hostname === 'api.cloudflare.com') return this.cloudflare(method, url, body)
    this.linked.push(new Headers(init?.headers))
    if (this.linkStatus !== 101) return new Response('no', { status: this.linkStatus })
    const socket = { accept: () => undefined, close: () => undefined }
    return { status: 101, webSocket: socket } as unknown as Response
  }
  private labelled<T extends { labels: Record<string, string> }>(list: T[], url: URL): T[] {
    const selector = url.searchParams.get('label_selector')
    if (!selector) return list
    const [key, value] = selector.split('==')
    return list.filter((one) => key !== undefined && one.labels[key] === value)
  }
  private hetzner(method: string, url: URL, body: unknown): Response {
    const path = url.pathname.replace('/v1', '')
    const given = (body ?? {}) as Record<string, unknown>
    let match: RegExpExecArray | null
    if (method === 'GET' && path === '/servers') {
      const servers = this.labelled(this.servers, url)
      for (const one of servers) {
        if (one.changing && --one.changing.looks <= 0) {
          one.type = one.changing.to
          delete one.changing
        }
      }
      return Response.json({
        servers: servers.map((one) => ({
          id: one.id,
          status: one.status,
          server_type: { name: one.type },
          datacenter: { location: { name: one.location } },
        })),
      })
    }
    if ((match = /^\/servers\/(\d+)\/actions\/(shutdown|poweroff|change_type)$/.exec(path))) {
      const server = this.servers.find((one) => one.id === Number(match?.[1]))
      if (!server) return Response.json({ error: { code: 'not_found', message: 'gone' } }, { status: 404 })
      if (server.changing) return Response.json({ error: { code: 'locked', message: 'busy' } }, { status: 423 })
      if (match[2] === 'shutdown') {
        if (!this.stubborn) server.status = 'off'
      } else if (match[2] === 'poweroff') {
        server.status = 'off'
      } else {
        const to = TYPES[String(given.server_type)]
        const from = TYPES[server.type]
        if (server.status !== 'off')
          return Response.json({ error: { code: 'server_not_stopped', message: 'on' } }, { status: 409 })
        if (!to || (from && (to.disk < from.disk || to.architecture !== from.architecture)))
          return Response.json({ error: { code: 'invalid_input', message: 'no' } }, { status: 422 })
        server.changing = { to: String(given.server_type), looks: this.changeLooks }
      }
      return Response.json({ action: { id: 3 } }, { status: 201 })
    }
    if (method === 'POST' && path === '/servers') {
      const firewalls = given.firewalls as { firewall: number }[]
      const made: FakeServer = {
        id: this.next++,
        name: String(given.name),
        status: 'initializing',
        location: String(given.location),
        type: String(given.server_type),
        labels: given.labels as Record<string, string>,
        userData: String(given.user_data),
        firewall: firewalls[0]?.firewall ?? 0,
      }
      this.servers.push(made)
      return Response.json(
        {
          server: {
            id: made.id,
            status: made.status,
            datacenter: { location: { name: made.location } },
          },
          root_password: 'never-read',
        },
        { status: 201 },
      )
    }
    if ((match = /^\/servers\/(\d+)$/.exec(path)) && method === 'DELETE') {
      const at = this.servers.findIndex((one) => one.id === Number(match?.[1]))
      if (at < 0) return Response.json({ error: { code: 'not_found', message: 'gone' } }, { status: 404 })
      this.servers.splice(at, 1)
      return Response.json({ action: { id: 1 } })
    }
    if ((match = /^\/servers\/(\d+)\/actions\/(reset|poweron)$/.exec(path))) {
      const server = this.servers.find((one) => one.id === Number(match?.[1]))
      if (server?.changing) return Response.json({ error: { code: 'locked', message: 'busy' } }, { status: 423 })
      if (server) server.status = 'running'
      return Response.json({ action: { id: 2 } }, { status: 201 })
    }
    if (method === 'GET' && path === '/firewalls') {
      return Response.json({
        firewalls: this.labelled(this.firewalls, url).map((one) => ({ id: one.id })),
      })
    }
    if (method === 'POST' && path === '/firewalls') {
      const made = {
        id: this.next++,
        name: String(given.name),
        labels: given.labels as Record<string, string>,
        rules: given.rules as unknown[],
      }
      this.firewalls.push(made)
      return Response.json({ firewall: { id: made.id }, actions: [] }, { status: 201 })
    }
    if ((match = /^\/firewalls\/(\d+)\/actions\/set_rules$/.exec(path))) {
      const wall = this.firewalls.find((one) => one.id === Number(match?.[1]))
      if (wall) wall.rules = given.rules as unknown[]
      return Response.json({ actions: [] }, { status: 201 })
    }
    if ((match = /^\/firewalls\/(\d+)$/.exec(path)) && method === 'DELETE') {
      const id = Number(match[1])
      if (this.servers.some((one) => one.firewall === id)) {
        return Response.json({ error: { code: 'resource_in_use', message: 'in use' } }, { status: 409 })
      }
      const at = this.firewalls.findIndex((one) => one.id === id)
      if (at >= 0) this.firewalls.splice(at, 1)
      return new Response(null, { status: 204 })
    }
    if (method === 'GET' && path === '/server_types') {
      const name = url.searchParams.get('name')
      const named = Object.entries(TYPES).filter(([one]) => name === null || one === name)
      return Response.json({
        server_types: named.map(([one, type]) => {
          return {
            name: one,
            cores: type.cores,
            memory: type.memory,
            disk: type.disk,
            cpu_type: type.cpu_type,
            architecture: type.architecture,
            deprecated: type.deprecated ?? false,
            prices: ['nbg1', 'fsn1', 'hel1'].map((location) => ({
              location,
              price_hourly: { net: '0', gross: type.hourly },
              price_monthly: { net: '0', gross: type.monthly },
            })),
            locations: ['nbg1', 'fsn1', 'hel1'].map((place, id) => ({
              id,
              name: place,
              available: this.available.includes(place),
            })),
          }
        }),
      })
    }
    if (method === 'GET' && path === '/locations') {
      return Response.json({
        locations: [
          { name: 'fsn1', city: 'Falkenstein', country: 'DE' },
          { name: 'nbg1', city: 'Nuremberg', country: 'DE' },
          { name: 'hel1', city: 'Helsinki', country: 'FI' },
          { name: 'ash', city: 'Ashburn, VA', country: 'US' },
        ],
      })
    }
    if (method === 'GET' && path === '/pricing') {
      return Response.json({
        pricing: {
          currency: 'EUR',
          primary_ips: [
            {
              type: 'ipv4',
              prices: ['nbg1', 'fsn1'].map((location) => ({
                location,
                price_hourly: { net: '0.0008', gross: '0.0010' },
                price_monthly: { net: '0.5000', gross: '0.5950' },
              })),
            },
          ],
        },
      })
    }
    return Response.json({ error: { code: 'not_found', message: path } }, { status: 404 })
  }
  private cloudflare(method: string, url: URL, body: unknown): Response {
    const path = url.pathname.replace('/client/v4', '')
    const given = (body ?? {}) as Record<string, unknown>
    const ok = (result: unknown, status = 200) => Response.json({ success: true, errors: [], result }, { status })
    let match: RegExpExecArray | null
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel$/.exec(path))) {
      if (method === 'GET') {
        const name = url.searchParams.get('name')
        return ok(this.tunnels.filter((one) => one.name === name).map(({ id, name: n }) => ({ id, name: n })))
      }
      const made = {
        id: `tunnel-${String(this.next++)}`,
        name: String(given.name),
        config: null,
        connections: true,
      }
      this.tunnels.push(made)
      return ok({ id: made.id, name: made.name })
    }
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/token$/.exec(path))) {
      return ok(`eyJ-token-of-${match[1] ?? ''}`)
    }
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/configurations$/.exec(path))) {
      const tunnel = this.tunnels.find((one) => one.id === match?.[1])
      if (tunnel) tunnel.config = given.config
      return ok({})
    }
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/connections$/.exec(path))) {
      const tunnel = this.tunnels.find((one) => one.id === match?.[1])
      if (tunnel) tunnel.connections = false
      return ok(null)
    }
    if ((match = /^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)$/.exec(path)) && method === 'DELETE') {
      const at = this.tunnels.findIndex((one) => one.id === match?.[1])
      if (this.tunnels[at]?.connections) {
        return Response.json({ success: false, errors: [{ code: 1022, message: 'connections' }] }, { status: 400 })
      }
      if (at >= 0) this.tunnels.splice(at, 1)
      return ok({})
    }
    if (/^\/zones\/[^/]+\/dns_records$/.test(path)) {
      if (method === 'GET') {
        const name = url.searchParams.get('name')
        return ok(this.records.filter((one) => one.name === name))
      }
      const made = {
        id: `record-${String(this.next++)}`,
        name: String(given.name),
        content: String(given.content),
        proxied: given.proxied === true,
      }
      this.records.push(made)
      return ok(made)
    }
    if ((match = /^\/zones\/[^/]+\/dns_records\/([^/]+)$/.exec(path))) {
      const at = this.records.findIndex((one) => one.id === match?.[1])
      if (method === 'DELETE' && at >= 0) this.records.splice(at, 1)
      return ok({ id: match[1] })
    }
    return Response.json({ success: false, errors: [{ code: 7003, message: path }] }, { status: 404 })
  }
}
