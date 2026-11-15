import { isNumber, isRecord, isString, keepJson, stored } from '../../platform/src/api'

const KEY = 'orden:ai-moves'

export interface Move {
  from: string
  to: string
  at: number
}

type Heard = (moves: readonly Move[]) => void

const heard = new Set<Heard>()

let ledger: Move[] | null = null

function isMove(value: unknown): value is Move {
  return isRecord(value) && isString(value.from) && isString(value.to) && isNumber(value.at)
}

function kept(): Move[] {
  if (ledger) return ledger
  const value = stored(KEY)
  ledger = Array.isArray(value) ? value.filter(isMove) : []
  return ledger
}

export function lastMove(moves: readonly Move[]): number {
  return moves.reduce((latest, one) => Math.max(latest, one.at), 0)
}

let known = lastMove(kept())

function told(moves: readonly Move[]): void {
  if (!moves.length) return
  known = Math.max(known, lastMove(moves))
  for (const listener of heard) listener(moves)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return
    ledger = null
    told(movesAfter(known))
  })
}

export function keepMoves(moved: Record<string, string>, at = Date.now()): void {
  const added = Object.entries(moved).map(([from, to]) => ({ from, to, at }))
  if (!added.length) return
  ledger = [...kept(), ...added]
  keepJson(KEY, ledger)
  told(added)
}

export function onMoves(listener: Heard): () => void {
  heard.add(listener)
  return () => heard.delete(listener)
}

export function movesAfter(at: number): Move[] {
  return kept().filter((one) => one.at > at)
}

export function movedTo(id: string, moves: readonly Move[]): string {
  return moves.reduce((now, one) => (one.from === now ? one.to : now), id)
}

export function movedSince(id: string, since: number): string {
  return movedTo(
    id,
    kept().filter((one) => one.at >= since),
  )
}

export function movedKeys<T>(record: Record<string, T>, moves: readonly Move[]): Record<string, T> {
  if (!moves.length) return record
  const out: Record<string, T> = {}
  const moving: [string, T][] = []
  for (const [key, one] of Object.entries(record)) {
    const cut = key.indexOf('/')
    const id = cut < 0 ? key : key.slice(0, cut)
    const to = movedTo(id, moves)
    if (to === id) out[key] = one
    else moving.push([to + key.slice(id.length), one])
  }
  for (const [key, one] of moving) out[key] = one
  return out
}
