import { account } from './account.svelte'
import { api, ApiError } from './api'
import { isRecord, keepJson, recordOf, stored } from './stored'

const MOST = 200

export function holder(): string | null {
  if (account.user) return account.user.id
  return account.guest ? `guest:${account.guest.id}` : null
}

type Ending = 'delete' | 'leave'

interface Icon {
  icon: string | null
  tint: string | null
}

class Shelf<T> {
  constructor(
    private readonly key: string,
    private readonly valid: (value: unknown) => value is T,
  ) {}

  private held(): Record<string, Record<string, T>> {
    const saved = stored(this.key)
    if (!isRecord(saved)) return {}
    const out: Record<string, Record<string, T>> = {}
    for (const [accountId, owed] of Object.entries(saved))
      out[accountId] = recordOf(owed, this.valid)
    return out
  }

  private kept(all: Record<string, Record<string, T>>) {
    const out: Record<string, Record<string, T>> = {}
    for (const [accountId, owed] of Object.entries(all)) {
      const list = Object.entries(owed).slice(-MOST)
      if (list.length) out[accountId] = Object.fromEntries(list)
    }
    keepJson(this.key, out)
  }

  of(accountId: string): Record<string, T> {
    return this.held()[accountId] ?? {}
  }

  put(accountId: string, spaceId: string, value: T) {
    const all = this.held()
    const owed = Object.entries(all[accountId] ?? {}).filter(([one]) => one !== spaceId)
    all[accountId] = Object.fromEntries([...owed, [spaceId, value]])
    this.kept(all)
  }

  paid(accountId: string, spaceId: string, value: T) {
    const all = this.held()
    const owed = all[accountId]
    if (!owed || JSON.stringify(owed[spaceId]) !== JSON.stringify(value)) return
    all[accountId] = Object.fromEntries(Object.entries(owed).filter(([one]) => one !== spaceId))
    this.kept(all)
  }
}

const ends = new Shelf<Ending>(
  'orden:space-ends',
  (value): value is Ending => value === 'delete' || value === 'leave',
)

const icons = new Shelf<Icon>(
  'orden:space-icons-owed',
  (value): value is Icon =>
    isRecord(value) &&
    (value.icon === null || typeof value.icon === 'string') &&
    (value.tint === null || typeof value.tint === 'string'),
)

const names = new Shelf<string>(
  'orden:space-names-owed',
  (value): value is string => typeof value === 'string',
)

const orders = new Shelf<string[]>(
  'orden:space-order-owed',
  (value): value is string[] =>
    Array.isArray(value) && value.every((one) => typeof one === 'string'),
)

const ORDER = 'order'

function unreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500
  return true
}

async function settled(asking: Promise<unknown>): Promise<boolean> {
  return await asking.then(
    () => true,
    (error: unknown) => !unreachable(error),
  )
}

async function told(token: string, accountId: string, spaceId: string, how: Ending) {
  const asking = how === 'leave' ? api.leaveSpace(token, spaceId) : api.deleteSpace(token, spaceId)
  if (await settled(asking)) ends.paid(accountId, spaceId, how)
}

export function endsOwed(accountId: string): Set<string> {
  return new Set(Object.keys(ends.of(accountId)))
}

export async function endSpace(
  token: string,
  accountId: string,
  spaceId: string,
  how: Ending,
): Promise<void> {
  ends.put(accountId, spaceId, how)
  await told(token, accountId, spaceId, how)
}

export async function settleEnds(token: string, accountId: string): Promise<void> {
  for (const [spaceId, how] of Object.entries(ends.of(accountId))) {
    await told(token, accountId, spaceId, how)
  }
}

export function iconOwed(accountId: string, spaceId: string): Icon | null {
  return icons.of(accountId)[spaceId] ?? null
}

export async function sendIcon(
  token: string,
  accountId: string,
  spaceId: string,
  icon: Icon,
): Promise<void> {
  icons.put(accountId, spaceId, icon)
  if (await settled(api.setSpaceIcon(token, spaceId, icon.icon, icon.tint))) {
    icons.paid(accountId, spaceId, icon)
  }
}

export async function sendName(
  token: string,
  accountId: string,
  spaceId: string,
  name: string,
): Promise<void> {
  names.put(accountId, spaceId, name)
  if (await settled(api.renameSpace(token, spaceId, name))) names.paid(accountId, spaceId, name)
}

export async function settleNames(token: string, accountId: string): Promise<void> {
  for (const [spaceId, name] of Object.entries(names.of(accountId))) {
    await sendName(token, accountId, spaceId, name)
  }
}

export async function sendOrder(token: string, accountId: string, order: string[]): Promise<void> {
  orders.put(accountId, ORDER, order)
  if (await settled(api.reorderSpaces(token, order))) orders.paid(accountId, ORDER, order)
}

export async function orderSent(token: string, accountId: string): Promise<boolean> {
  const owed = orders.of(accountId)[ORDER]
  if (!owed) return false
  await sendOrder(token, accountId, owed)
  return true
}
