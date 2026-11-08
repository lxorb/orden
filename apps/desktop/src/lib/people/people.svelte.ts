import { account } from '../account.svelte'
import { PRESENCE_EVERY } from '../backoff'
import { fetchNicks, fetchPeople, fetchPresence } from './calls'
import type { Presence } from './face'
import type { Person } from './read'

const AT_ONCE = 200

class People {
  known = $state<Record<string, Person>>({})
  nicknames = $state<Record<string, Record<string, string>>>({})

  readonly mine = $derived.by((): Person | null => {
    const user = account.user
    if (!user) return null
    return {
      id: user.id,
      name: account.name ?? '',
      avatar: user.avatar ?? null,
      pronouns: user.pronouns ?? null,
      bio: user.bio ?? null,
      status: user.status ?? null,
      zone: user.zone ?? null,
      presence: user.hidden ? 'offline' : 'active',
    }
  })

  private readonly asked = new Set<string>()
  private readonly waiting = new Set<string>()
  private readonly spacesAsked = new Set<string>()
  private readonly watchers = new Set<() => readonly string[]>()
  private ticking: ReturnType<typeof setInterval> | undefined

  constructor() {
    account.forgetWithSession(() => this.forget())
  }

  of(id: string): Person | undefined {
    const mine = this.mine
    if (mine?.id === id) return mine

    const known = this.known[id]
    if (!known) this.ask(id)
    return known
  }

  refresh(id: string): void {
    if (this.mine?.id === id) return
    this.asked.delete(id)
    this.ask(id)
  }

  called(id: string, space?: string | null): string | undefined {
    if (space) {
      const own = this.mine?.id === id ? account.user?.nicks?.[space] : undefined
      const nick = own ?? this.nickIn(space)[id]
      if (nick) return nick
    }
    return this.of(id)?.name
  }

  nickIn(space: string): Record<string, string> {
    if (!this.spacesAsked.has(space)) {
      this.spacesAsked.add(space)
      queueMicrotask(() => void this.askNicks(space))
    }
    return this.nicknames[space] ?? {}
  }

  watch(ids: () => readonly string[]): () => void {
    this.watchers.add(ids)
    queueMicrotask(() => void this.tick())
    this.ticking ??= setInterval(() => void this.tick(), PRESENCE_EVERY)
    return () => {
      this.watchers.delete(ids)
      if (this.watchers.size || this.ticking === undefined) return
      clearInterval(this.ticking)
      this.ticking = undefined
    }
  }

  private ask(id: string): void {
    if (this.asked.has(id) || !id) return
    this.asked.add(id)
    this.waiting.add(id)
    if (this.waiting.size === 1) queueMicrotask(() => void this.flush())
  }

  private async flush(): Promise<void> {
    const ids = [...this.waiting]
    this.waiting.clear()
    const token = account.accountToken
    if (!token) {
      for (const id of ids) this.asked.delete(id)
      return
    }

    for (let at = 0; at < ids.length; at += AT_ONCE) {
      const chunk = ids.slice(at, at + AT_ONCE)
      try {
        const found = await fetchPeople(token, chunk)
        if (account.accountToken !== token) return
        this.known = { ...this.known, ...Object.fromEntries(found.map((one) => [one.id, one])) }
      } catch {
        setTimeout(() => {
          for (const id of chunk) this.asked.delete(id)
        }, PRESENCE_EVERY)
      }
    }
  }

  private async askNicks(space: string): Promise<void> {
    const token = account.accountToken
    if (!token) {
      this.spacesAsked.delete(space)
      return
    }
    try {
      const nicks = await fetchNicks(token, space)
      if (account.accountToken === token) this.nicknames = { ...this.nicknames, [space]: nicks }
    } catch {
      this.spacesAsked.delete(space)
    }
  }

  private async tick(): Promise<void> {
    const token = account.accountToken
    if (!token || (typeof document !== 'undefined' && document.hidden)) return

    const mine = this.mine?.id
    const ids = [...new Set([...this.watchers].flatMap((one) => one()))].filter((id) => id !== mine)
    if (!ids.length) return

    try {
      const said = await fetchPresence(token, ids.slice(0, AT_ONCE))
      this.heard(said)
    } catch {
      // What was known stands until the next minute.
    }
  }

  private heard(said: Record<string, Presence>): void {
    let changed = false
    const next = { ...this.known }
    for (const [id, presence] of Object.entries(said)) {
      const known = next[id]
      if (!known || known.presence === presence) continue
      next[id] = { ...known, presence }
      changed = true
    }
    if (changed) this.known = next
  }

  private forget(): void {
    this.known = {}
    this.nicknames = {}
    this.asked.clear()
    this.waiting.clear()
    this.spacesAsked.clear()
  }
}

export const people = new People()
