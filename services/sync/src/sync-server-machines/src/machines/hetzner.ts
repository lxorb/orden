const API = 'https://api.hetzner.cloud/v1'
export class HetznerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HetznerError'
  }
}
export interface Server {
  id: number
  status: string
  location: string
}
interface Price {
  location: string
  monthly: number
  hourly: number
}
export interface ServerType {
  name: string
  cores: number
  memory: number
  disk: number
  prices: Price[]
  available: string[]
}
export interface Pricing {
  currency: string
  ipv4: Map<string, { monthly: number; hourly: number }>
}
export interface NewServer {
  name: string
  serverType: string
  location: string
  userData: string
  labels: Record<string, string>
  firewall: number
}
type Fetch = typeof fetch
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function serverOf(value: unknown): Server | null {
  if (!isRecord(value) || typeof value.id !== 'number' || typeof value.status !== 'string') {
    return null
  }
  const datacenter = isRecord(value.datacenter) ? value.datacenter : null
  const location = datacenter && isRecord(datacenter.location) ? datacenter.location.name : null
  return {
    id: value.id,
    status: value.status,
    location: typeof location === 'string' ? location : '',
  }
}
const listed = (value: unknown, key: string): unknown[] => {
  const list = isRecord(value) ? value[key] : null
  return Array.isArray(list) ? list : []
}
function typeOf(value: unknown): ServerType | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null
  if (typeof value.cores !== 'number' || typeof value.memory !== 'number') return null
  const prices = listed(value, 'prices').flatMap((one): Price[] => {
    if (!isRecord(one) || typeof one.location !== 'string') return []
    const monthly = amount(one.price_monthly)
    const hourly = amount(one.price_hourly)
    return monthly === null ? [] : [{ location: one.location, monthly, hourly: hourly ?? 0 }]
  })
  const available = listed(value, 'locations').flatMap((one) =>
    isRecord(one) && typeof one.name === 'string' && one.available !== false && !isRecord(one.deprecation)
      ? [one.name]
      : [],
  )
  return {
    name: value.name,
    cores: value.cores,
    memory: value.memory,
    disk: typeof value.disk === 'number' ? value.disk : 0,
    prices,
    available,
  }
}
function amount(value: unknown): number | null {
  const gross = isRecord(value) ? Number(value.gross) : Number.NaN
  return Number.isFinite(gross) && gross >= 0 ? gross : null
}
export class Hetzner {
  constructor(
    private readonly token: string,
    private readonly fetcher: Fetch = (input, init) => fetch(input, init),
  ) {}
  private async ask(method: string, path: string, body?: unknown): Promise<unknown> {
    const answer = await this.fetcher(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await answer.text()
    let said: unknown = null
    try {
      said = text ? JSON.parse(text) : null
    } catch {
      // Not JSON: the status says enough.
    }
    if (!answer.ok) {
      const error = isRecord(said) && isRecord(said.error) ? said.error : {}
      throw new HetznerError(
        answer.status,
        typeof error.code === 'string' ? error.code : 'http',
        typeof error.message === 'string' ? error.message : `Hetzner answered ${String(answer.status)}`,
      )
    }
    return said
  }
  async serverLabelled(key: string, value: string): Promise<Server | null> {
    const selector = encodeURIComponent(`${key}==${value}`)
    const said = await this.ask('GET', `/servers?label_selector=${selector}`)
    const servers = isRecord(said) && Array.isArray(said.servers) ? said.servers : []
    return serverOf(servers[0])
  }
  async createServer(server: NewServer): Promise<Server> {
    const said = await this.ask('POST', '/servers', {
      name: server.name,
      server_type: server.serverType,
      location: server.location,
      image: 'ubuntu-24.04',
      user_data: server.userData,
      labels: server.labels,
      firewalls: [{ firewall: server.firewall }],
      public_net: { enable_ipv4: true, enable_ipv6: true },
      start_after_create: true,
    })
    const made = isRecord(said) ? serverOf(said.server) : null
    if (!made) throw new HetznerError(502, 'shape', 'the made server did not read')
    return made
  }
  async deleteServer(id: number): Promise<void> {
    await this.ask('DELETE', `/servers/${String(id)}`)
  }
  async reset(id: number): Promise<void> {
    await this.ask('POST', `/servers/${String(id)}/actions/reset`)
  }
  async powerOn(id: number): Promise<void> {
    await this.ask('POST', `/servers/${String(id)}/actions/poweron`)
  }
  async firewallLabelled(key: string, value: string): Promise<number | null> {
    const selector = encodeURIComponent(`${key}==${value}`)
    const said = await this.ask('GET', `/firewalls?label_selector=${selector}`)
    const walls = isRecord(said) && Array.isArray(said.firewalls) ? said.firewalls : []
    const first: unknown = walls[0]
    return isRecord(first) && typeof first.id === 'number' ? first.id : null
  }
  async createFirewall(name: string, labels: Record<string, string>, rules: unknown[]) {
    const said = await this.ask('POST', '/firewalls', { name, labels, rules })
    const wall = isRecord(said) && isRecord(said.firewall) ? said.firewall : null
    if (!wall || typeof wall.id !== 'number') {
      throw new HetznerError(502, 'shape', 'the made firewall did not read')
    }
    return wall.id
  }
  async setFirewallRules(id: number, rules: unknown[]): Promise<void> {
    await this.ask('POST', `/firewalls/${String(id)}/actions/set_rules`, { rules })
  }
  async deleteFirewall(id: number): Promise<void> {
    await this.ask('DELETE', `/firewalls/${String(id)}`)
  }
  async serverType(name: string): Promise<ServerType> {
    const said = await this.ask('GET', `/server_types?name=${encodeURIComponent(name)}`)
    const type = typeOf(listed(said, 'server_types')[0])
    if (!type) throw new HetznerError(404, 'not_found', `no server type ${name}`)
    return { ...type, name }
  }
  async pricing(): Promise<Pricing> {
    const said = await this.ask('GET', '/pricing')
    const pricing = isRecord(said) && isRecord(said.pricing) ? said.pricing : {}
    const ipv4 = new Map<string, { monthly: number; hourly: number }>()
    for (const ip of listed(pricing, 'primary_ips')) {
      if (!isRecord(ip) || ip.type !== 'ipv4') continue
      for (const one of listed(ip, 'prices')) {
        if (!isRecord(one) || typeof one.location !== 'string') continue
        ipv4.set(one.location, {
          monthly: amount(one.price_monthly) ?? 0,
          hourly: amount(one.price_hourly) ?? 0,
        })
      }
    }
    return { currency: typeof pricing.currency === 'string' ? pricing.currency : 'EUR', ipv4 }
  }
}
