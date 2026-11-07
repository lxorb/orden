export type Colour = '1' | '2' | '3' | '4' | '5' | '6'

export const COLOURS: readonly Colour[] = ['1', '2', '3', '4', '5', '6']

export interface ConfigHost {
  id: string
  also: string[]
  hostname?: string
  user?: string
  port?: number
  group?: string
}

export interface Own {
  id: string
  name: string
  hostname: string
  user?: string
  port?: number
}

export interface About {
  colour?: Colour
  group?: string
  pinned?: boolean
  last?: number
}

export interface Kept {
  own: Own[]
  about: Record<string, About>
  order: string[]
  groups: string[]
}

export const NOTHING_KEPT: Kept = { own: [], about: {}, order: [], groups: [] }

export interface Host {
  id: string
  name: string
  own: boolean
  also: string[]
  detail: string | null
  user: string | null
  hostname: string | null
  port: number | null
  group: string | null
  colour: Colour | null
  pinned: boolean
  last: number | null
}

function detailOf(user: string | null, hostname: string | null, port: number | null, name: string) {
  const address = hostname ?? (user || port ? name : null)
  if (!address) return null

  const at = user ? `${user}@${address}` : address
  const said = port && port !== 22 ? `${at}:${port}` : at
  return said === name ? null : said
}

export function hostsOf(config: readonly ConfigHost[], kept: Kept): Host[] {
  const about = (id: string): About => kept.about[id] ?? {}

  const fromConfig = config.map((one): Host => {
    const known = about(one.id)
    return {
      id: one.id,
      name: one.id,
      own: false,
      also: [...one.also, ...(one.hostname ? [one.hostname] : [])],
      detail: detailOf(one.user ?? null, one.hostname ?? null, one.port ?? null, one.id),
      user: one.user ?? null,
      hostname: one.hostname ?? null,
      port: one.port ?? null,
      group: known.group ?? one.group ?? null,
      colour: known.colour ?? null,
      pinned: known.pinned ?? false,
      last: known.last ?? null,
    }
  })

  const made = kept.own.map((one): Host => {
    const known = about(one.id)
    return {
      id: one.id,
      name: one.name,
      own: true,
      also: [one.hostname],
      detail: detailOf(one.user ?? null, one.hostname, one.port ?? null, one.name),
      user: one.user ?? null,
      hostname: one.hostname,
      port: one.port ?? null,
      group: known.group ?? null,
      colour: known.colour ?? null,
      pinned: known.pinned ?? false,
      last: known.last ?? null,
    }
  })

  const all = [...fromConfig, ...made]
  const place = new Map(kept.order.map((id, at) => [id, at]))
  const rank = (host: Host) => place.get(host.id) ?? Number.MAX_SAFE_INTEGER
  return all
    .map((host, at) => ({ host, at }))
    .sort((a, b) => rank(a.host) - rank(b.host) || a.at - b.at)
    .map(({ host }) => host)
}

export function groupsOf(hosts: readonly Host[], kept: Kept): string[] {
  const out = [...kept.groups]
  for (const host of hosts) if (host.group && !out.includes(host.group)) out.push(host.group)
  return out.filter((group) => hosts.some((host) => host.group === group))
}

export const RECENT = 5

export interface Placed {
  host: Host
  head: string | null
  parted: boolean
}

export function pickerOrder(hosts: readonly Host[], kept: Kept): Placed[] {
  const pinned = hosts.filter((host) => host.pinned)
  const left = new Map<string, number>()
  for (const host of hosts) {
    if (host.group && !host.pinned) left.set(host.group, (left.get(host.group) ?? 0) + 1)
  }
  const recent: Host[] = []
  const lately = hosts
    .filter((host) => !host.pinned && host.last !== null)
    .sort((a, b) => (b.last ?? 0) - (a.last ?? 0))
  for (const host of lately) {
    if (recent.length === RECENT) break
    const others = host.group ? (left.get(host.group) ?? 0) : 2
    if (others < 2) continue
    if (host.group) left.set(host.group, others - 1)
    recent.push(host)
  }
  const taken = new Set([...pinned, ...recent].map((host) => host.id))
  const rest = hosts.filter((host) => !taken.has(host.id))

  const sections: [readonly Host[], string | null][] = [
    [pinned, null],
    [recent, null],
    [rest.filter((host) => !host.group), null],
    ...groupsOf(rest, kept).map((group): [Host[], string] => [
      rest.filter((host) => host.group === group),
      group,
    ]),
  ]

  const out: Placed[] = []
  for (const [list, group] of sections) {
    const parted = out.length > 0 && group === null
    list.forEach((host, at) => {
      out.push({ host, head: at === 0 ? group : null, parted: at === 0 && parted })
    })
  }
  return out
}

export function searchName(host: Host): string {
  return [host.name, ...host.also].join(' ')
}

export interface Destination {
  user: string | null
  hostname: string
  port: number | null
}

const ADDRESS = /^(?!-)[A-Za-z0-9._:%-]{1,253}$/
const USER = /^(?!-)[A-Za-z0-9._@\\$-]{1,64}$/

export function destinationOf(typed: string): Destination | null {
  const text = typed.trim().replace(/^ssh\s+/i, '')
  if (!text || /\s/.test(text)) return null

  const at = text.lastIndexOf('@')
  const user = at > 0 ? text.slice(0, at) : null
  const rest = at > 0 ? text.slice(at + 1) : text

  let hostname = rest
  let port: number | null = null
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest)
  const portEnd = /^([^:]+):(\d+)$/.exec(rest)
  if (bracketed?.[1]) {
    hostname = bracketed[1]
    port = bracketed[2] ? Number(bracketed[2]) : null
  } else if (portEnd?.[1] && portEnd[2]) {
    hostname = portEnd[1]
    port = Number(portEnd[2])
  }

  if (!ADDRESS.test(hostname) || (user !== null && !USER.test(user))) return null
  if (port !== null && (port < 1 || port > 65535)) return null
  return { user, hostname, port }
}

export function mayBeDestination(typed: string): boolean {
  return /^[A-Za-z0-9._:%@\\$[\]-]+$/.test(typed)
}

export function plainlyDestination(typed: string): boolean {
  return /[@:.]/.test(typed)
}

export function hostFor(hosts: readonly Host[], wanted: Destination): Host | null {
  const plain = !wanted.user && wanted.port === null
  return (
    hosts.find(
      (host) =>
        (plain && (host.name === wanted.hostname || host.also.includes(wanted.hostname))) ||
        (host.hostname === wanted.hostname &&
          host.user === wanted.user &&
          (host.port ?? null) === wanted.port),
    ) ?? null
  )
}

export function hostReached(hosts: readonly Host[], reached: Destination): Host | null {
  return (
    hostFor(hosts, reached) ??
    hosts.find(
      (host) =>
        (host.name === reached.hostname || host.also.includes(reached.hostname)) &&
        (reached.user === null || reached.user === host.user) &&
        (reached.port === null || reached.port === (host.port ?? 22)),
    ) ??
    null
  )
}

export function groupHosts(hosts: readonly Host[], group: string): Host[] {
  return hosts.filter((host) => host.group === group)
}

export function said(wanted: Destination): string {
  const at = (address: string) => (wanted.user ? `${wanted.user}@${address}` : address)
  if (wanted.port === null) return at(wanted.hostname)

  const address = wanted.hostname.includes(':') ? `[${wanted.hostname}]` : wanted.hostname
  return `${at(address)}:${wanted.port}`
}

export type Change<T> = { [K in keyof T]?: T[K] | undefined }

export function withAbout(kept: Kept, id: string, change: Change<About>): Kept {
  const merged = { ...kept.about[id], ...change }
  const about = Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined && value !== false),
  ) as About
  const rest = Object.fromEntries(Object.entries(kept.about).filter(([one]) => one !== id))
  return {
    ...kept,
    about: Object.keys(about).length ? { ...rest, [id]: about } : rest,
  }
}

export function withOwn(kept: Kept, id: string, change: Change<Omit<Own, 'id'>>): Kept {
  return {
    ...kept,
    own: kept.own.map((one) => {
      if (one.id !== id) return one
      const { user, port, ...rest } = { ...one, ...change }
      return {
        ...rest,
        id: one.id,
        name: rest.name ?? one.name,
        hostname: rest.hostname ?? one.hostname,
        ...(user ? { user } : {}),
        ...(port !== undefined ? { port } : {}),
      }
    }),
  }
}

export function withoutOwn(kept: Kept, id: string): Kept {
  const about = Object.fromEntries(Object.entries(kept.about).filter(([one]) => one !== id))
  return {
    ...kept,
    own: kept.own.filter((one) => one.id !== id),
    about,
    order: kept.order.filter((one) => one !== id),
  }
}

export function moved(kept: Kept, hosts: readonly Host[], from: number, to: number): Kept {
  const ids = hosts.map((host) => host.id)
  const [one] = ids.splice(from, 1)
  if (one === undefined) return kept
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, one)

  const byId = new Map(hosts.map((host) => [host.id, host]))
  const groups: string[] = []
  for (const id of ids) {
    const group = byId.get(id)?.group
    if (group && !groups.includes(group)) groups.push(group)
  }
  return { ...kept, order: ids, groups }
}
