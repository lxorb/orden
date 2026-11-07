import { api, ApiError } from './api'
import { isRecord, keepJson, recordOf, stored } from './stored'

const KEY = 'orden:space-ends'

const MOST = 200

type Ending = 'delete' | 'leave'

type Owed = Record<string, Record<string, Ending>>

function isEnding(value: unknown): value is Ending {
  return value === 'delete' || value === 'leave'
}

function held(): Owed {
  const saved = stored(KEY)
  if (!isRecord(saved)) return {}
  const out: Owed = {}
  for (const [accountId, ends] of Object.entries(saved)) {
    if (isRecord(ends)) out[accountId] = recordOf(ends, isEnding)
  }
  return out
}

function kept(owed: Owed) {
  const out: Owed = {}
  for (const [accountId, ends] of Object.entries(owed)) {
    const list = Object.entries(ends).slice(-MOST)
    if (list.length) out[accountId] = Object.fromEntries(list)
  }
  keepJson(KEY, out)
}

export function endsOwed(accountId: string): Set<string> {
  return new Set(Object.keys(held()[accountId] ?? {}))
}

function paid(accountId: string, spaceId: string) {
  const owed = held()
  const ends = owed[accountId]
  if (!ends || !(spaceId in ends)) return
  delete ends[spaceId]
  kept(owed)
}

function unreachable(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 429 || error.status >= 500
  return true
}

async function told(token: string, accountId: string, spaceId: string, how: Ending) {
  const asking = how === 'leave' ? api.leaveSpace(token, spaceId) : api.deleteSpace(token, spaceId)
  const settled = await asking.then(
    () => true,
    (error: unknown) => !unreachable(error),
  )
  if (settled) paid(accountId, spaceId)
}

export async function endSpace(
  token: string,
  accountId: string,
  spaceId: string,
  how: Ending,
): Promise<void> {
  const owed = held()
  owed[accountId] = { ...owed[accountId], [spaceId]: how }
  kept(owed)
  await told(token, accountId, spaceId, how)
}

export async function settleEnds(token: string, accountId: string): Promise<void> {
  const ends = held()[accountId] ?? {}
  for (const [spaceId, how] of Object.entries(ends)) await told(token, accountId, spaceId, how)
}
