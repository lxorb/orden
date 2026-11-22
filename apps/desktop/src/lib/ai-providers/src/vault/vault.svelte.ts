import type { Accounts } from '../accounts'
import { fingerprint } from './crypto'
import { agrees, type Base, baseOf, type Contents, contentsIn, merged, type Side } from './merge'

const PATH = '/v2/ai/accounts'
const TRIES = 3
export type Standing = 'off' | 'opening' | 'open'
interface Read {
  rev: number
  contents: string | null
}
export interface VaultWorld {
  account(): string | null
  call<T>(path: string, method?: string, body?: unknown): Promise<T>
  local(): Promise<Contents>
  apply(contents: Contents, before: Contents, moved: Record<string, string>): Promise<void>
  loadBase(account: string): Base | null
  keepBase(account: string, base: Base | null): void
  served(): string | null
  serve(account: string | null): void
  drop(gone: Accounts['accounts']): Promise<void>
}
function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 409
}
function parsedIn(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
async function printsOf(keys: Record<string, string>): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(keys).map(async ([id, key]) => [id, await fingerprint(key)] as const),
  )
  return Object.fromEntries(entries)
}
async function sideOf(contents: Contents): Promise<Side> {
  return { contents, prints: await printsOf(contents.keys) }
}
export class Vault {
  standing = $state<Standing>('off')
  seen = $state.raw<Record<string, string>>({})
  private running: Promise<void> | null = null
  private again = false
  constructor(private readonly world: VaultWorld) {}
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.once().catch(() => undefined)
      } while (this.asked())
    })().finally(() => {
      this.running = null
    })
    return this.running
  }
  private asked(): boolean {
    return this.again
  }
  private async once(): Promise<void> {
    const account = this.world.account()
    if (!account) {
      this.signedOut()
      return
    }
    const was = this.world.served()
    if (was !== account) {
      if (was) await this.left()
      this.world.serve(account)
    }
    if (this.standing === 'off') this.standing = 'opening'
    for (let tries = 0; tries < TRIES; tries++) {
      if (await this.met(account, await this.world.call<Read>(PATH))) return
    }
  }
  private async met(account: string, read: Read): Promise<boolean> {
    const local = await this.world.local()
    const here = await sideOf({ ...local, seen: { ...this.seen, ...local.seen } })
    const remote = read.contents === null ? null : await sideOf(contentsIn(parsedIn(read.contents)))
    const base = this.world.loadBase(account)
    const { contents, moved } = remote ? merged(base, here, remote) : { contents: here.contents, moved: {} }
    const prints = await printsOf(contents.keys)
    if (this.world.account() !== account) return true
    this.seen = contents.seen
    if (!agrees(baseOf(here.contents, here.prints), contents, prints)) {
      await this.world.apply(contents, local, moved)
    }
    this.standing = 'open'
    if (remote && agrees(baseOf(remote.contents, remote.prints), contents, prints)) {
      this.world.keepBase(account, baseOf(contents, prints))
      return true
    }
    if (this.world.account() !== account) return true
    try {
      await this.world.call(PATH, 'PUT', { rev: read.rev, contents: JSON.stringify(contents) })
    } catch (error) {
      if (isConflict(error)) return false
      throw error
    }
    this.world.keepBase(account, baseOf(contents, prints))
    return true
  }
  async left(kept = false): Promise<void> {
    const was = this.world.served()
    this.signedOut()
    if (!was) return
    const base = this.world.loadBase(was)
    this.world.keepBase(was, null)
    this.world.serve(null)
    if (base && !kept) await this.world.drop(base.accounts.accounts)
  }
  signedOut(): void {
    this.standing = 'off'
    this.seen = {}
  }
}
