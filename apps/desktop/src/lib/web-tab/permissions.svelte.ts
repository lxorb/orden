import { invoke, isDesktop } from '../tauri'
import { withOrWithout } from '../records'
import { isRecord, Shared } from '../stored'
import { originKey } from './address'

const STORAGE_KEY = 'orden:web-grants'

export const ASKS = [
  'camera',
  'microphone',
  'location',
  'notifications',
  'clipboard',
  'sensors',
  'downloads',
  'fonts',
  'midi',
  'windows',
] as const

export type Ask = (typeof ASKS)[number]

type Answer = 'allow' | 'block'

function isAsk(value: string): value is Ask {
  return ASKS.some((one) => one === value)
}

function isAnswer(value: unknown): value is Answer {
  return value === 'allow' || value === 'block'
}

export function siteOf(url: string | null): string {
  return url === null ? '' : originKey(url)
}

export interface Asking {
  id: number
  tab: string
  site: string
  ask: Ask
  privately: boolean
}

type Table = Record<string, Partial<Record<Ask, Answer>>>

function readTable(read: unknown): Table {
  if (!isRecord(read)) return {}

  const out: Table = {}
  for (const [site, value] of Object.entries(read)) {
    if (!isRecord(value)) continue

    const said: Partial<Record<Ask, Answer>> = {}
    for (const [kind, answer] of Object.entries(value)) {
      if (isAsk(kind) && isAnswer(answer)) said[kind] = answer
    }
    if (Object.keys(said).length) out[site] = said
  }
  return out
}

export function readAsked(value: unknown): Asking | null {
  if (!isRecord(value)) return null

  const { tab, id, origin, kind } = value
  if (typeof tab !== 'string' || typeof id !== 'number') return null
  if (typeof origin !== 'string' || typeof kind !== 'string' || !isAsk(kind)) return null

  return { id, tab, site: originKey(origin) || origin, ask: kind, privately: false }
}

class Grants {
  private readonly kept = new Shared(STORAGE_KEY, readTable)

  private changed = $state(0)

  private privately = $state<Table>({})

  asking = $state<Asking[]>([])

  constructor() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) this.changed++
    })
  }

  private by(): Table {
    this.heardChange()
    return this.kept.get()
  }

  private heardChange(): number {
    return this.changed
  }

  of(site: string, privately = false): Partial<Record<Ask, Answer>> {
    const by = this.by()
    if (!privately) return by[site] ?? {}

    const blocked = Object.entries(by[site] ?? {}).filter(([, said]) => said === 'block')
    return { ...Object.fromEntries(blocked), ...this.privately[site] }
  }

  said(site: string, ask: Ask, privately = false): Answer | null {
    return this.of(site, privately)[ask] ?? null
  }

  remember(site: string, ask: Ask, answer: Answer | null, privately = false) {
    if (!site) return

    const before = (privately ? this.privately : this.by())[site] ?? {}
    const kept = Object.fromEntries(
      Object.entries(before).filter(([one]) => one !== ask),
    ) as Partial<Record<Ask, Answer>>
    if (answer !== null) kept[ask] = answer

    if (privately) {
      this.privately = withOrWithout(this.privately, site, Object.keys(kept).length ? kept : null)
      return
    }

    this.write(withOrWithout(this.by(), site, Object.keys(kept).length ? kept : null))
  }

  private write(all: Table) {
    this.kept.set(all, JSON.stringify(all))
    this.changed++
  }

  heard(said: Asking) {
    const already = this.said(said.site, said.ask, said.privately)
    if (already !== null) {
      void this.tell(said.id, already === 'allow')
      return
    }

    this.asking = [...this.asking, said]
  }

  answer(said: Asking, allow: boolean) {
    this.remember(said.site, said.ask, allow ? 'allow' : 'block', said.privately)

    const same = this.asking.filter(
      (one) => one.site === said.site && one.ask === said.ask && one.privately === said.privately,
    )
    this.asking = this.asking.filter((one) => !same.includes(one))
    for (const one of same) void this.tell(one.id, allow)
  }

  dismiss(said: Asking) {
    this.asking = this.asking.filter((one) => one.id !== said.id)
    void this.tell(said.id, false)
  }

  dropped(tab: string, privateLeft = true) {
    if (!privateLeft) this.privately = {}

    const gone = this.asking.filter((one) => one.tab === tab)
    if (!gone.length) return

    this.asking = this.asking.filter((one) => one.tab !== tab)
    for (const one of gone) void this.tell(one.id, false)
  }

  refused(id: number) {
    void this.tell(id, false)
  }

  private async tell(id: number, allow: boolean): Promise<void> {
    if (!isDesktop) return
    await invoke('web_answer', { id, allow }).catch(() => undefined)
  }

  forget(site: string, privately = false) {
    if (privately) {
      this.privately = withOrWithout<Partial<Record<Ask, Answer>>>(this.privately, site, null)
      return
    }
    const all = this.by()
    if (!all[site]) return

    this.write(withOrWithout<Partial<Record<Ask, Answer>>>(all, site, null))
  }
}

export const grants = new Grants()
