import { isRecord, isString } from '../stored'
import { invoke, isDesktop } from '../tauri'
import {
  type ConfigHost,
  type Destination,
  type Host,
  hostsOf,
  type Kept,
  NOTHING_KEPT,
  type Own,
  said,
} from './hosts'

function readAnswer(value: unknown): { config: ConfigHost[]; kept: Kept; file: string | null } {
  const answer = isRecord(value) ? value : {}
  const listed: unknown[] = Array.isArray(answer.config) ? answer.config : []
  const config = listed.flatMap((one) =>
    isRecord(one) && isString(one.id)
      ? [{ ...(one as unknown as ConfigHost), also: Array.isArray(one.also) ? one.also : [] }]
      : [],
  )
  return {
    config,
    kept: readKept(answer.kept),
    file: typeof answer.file === 'string' ? answer.file : null,
  }
}

function readKept(value: unknown): Kept {
  if (!isRecord(value)) return NOTHING_KEPT
  const kept = value as Partial<Kept>
  return {
    own: Array.isArray(kept.own) ? kept.own : [],
    about: isRecord(kept.about) ? kept.about : {},
    order: Array.isArray(kept.order) ? kept.order : [],
    groups: Array.isArray(kept.groups) ? kept.groups : [],
  }
}

function ownId(): string {
  return `n-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`
}

class Remote {
  hosts = $state.raw<Host[]>([])
  kept = $state.raw<Kept>(NOTHING_KEPT)
  file = $state<string | null>(null)
  read = $state(false)

  private config: ConfigHost[] = []
  private asking: Promise<void> | null = null

  refresh(): Promise<void> {
    if (!isDesktop) return Promise.resolve()

    this.asking ??= invoke<unknown>('remote_hosts')
      .then((answer) => {
        const { config, kept, file } = readAnswer(answer)
        this.config = config
        this.file = file
        this.take(kept)
      })
      .catch(() => undefined)
      .finally(() => {
        this.read = true
        this.asking = null
      })
    return this.asking
  }

  async ready(): Promise<void> {
    if (!this.read) await this.refresh()
  }

  byId(id: string): Host | undefined {
    return this.hosts.find((host) => host.id === id)
  }

  private take(kept: Kept) {
    this.kept = kept
    this.hosts = hostsOf(this.config, kept)
  }

  async keep(change: (kept: Kept) => Kept): Promise<void> {
    const next = change(this.kept)
    this.take(next)
    try {
      this.take(readKept(await invoke<unknown>('remote_keep', { kept: next })))
    } catch {
      await this.refresh()
    }
  }

  async make(wanted: Destination, name?: string): Promise<Host | undefined> {
    const own: Own = {
      id: ownId(),
      name: name?.trim() ? name.trim() : said(wanted),
      hostname: wanted.hostname,
      ...(wanted.user ? { user: wanted.user } : {}),
      ...(wanted.port !== null ? { port: wanted.port } : {}),
    }
    await this.keep((kept) => ({ ...kept, own: [...kept.own, own] }))
    return this.byId(own.id)
  }

  connected(id: string): void {
    const about = { ...this.kept.about, [id]: { ...this.kept.about[id], last: Date.now() } }
    this.take({ ...this.kept, about })
  }
}

export const remote = new Remote()
