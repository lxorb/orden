import type { Attachment, Content, Envelope } from '@orden/pass/types'

type Side = 'mine' | 'theirs'

export interface Merged {
  envelope: Envelope
  lost: Side | null
}

interface Picked<T> {
  value: T
  clashed: boolean
}

type Fields = Record<string, unknown>

const UNKNOWN: unique symbol = Symbol('unknown')

type Base = unknown

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function idOf(value: unknown): string | null {
  return isFields(value) && typeof value.id === 'string' ? value.id : null
}

function isListById(value: unknown): value is Fields[] {
  return Array.isArray(value) && value.every((one) => idOf(one) !== null)
}

function byId(list: readonly Fields[]): Map<string, Fields> {
  return new Map(list.map((one) => [idOf(one) ?? '', one]))
}

function under(base: Base, key: string): Base {
  if (base === UNKNOWN) return UNKNOWN
  return isFields(base) ? base[key] : undefined
}

function pickedList(
  base: Base,
  mine: Fields[],
  theirs: Fields[],
  mineWins: boolean,
): Picked<Fields[]> {
  const was = base === UNKNOWN ? null : byId(isListById(base) ? base : [])
  const ours = byId(mine)
  const yours = byId(theirs)
  const order = [...ours.keys(), ...[...yours.keys()].filter((id) => !ours.has(id))]
  let clashed = false
  const value: Fields[] = []
  for (const id of order) {
    const one = picked(was ? was.get(id) : UNKNOWN, ours.get(id), yours.get(id), mineWins)
    clashed ||= one.clashed
    if (one.value !== undefined) value.push(one.value as Fields)
  }
  return { value, clashed }
}

function pickedFields(base: Base, mine: Fields, theirs: Fields, mineWins: boolean): Picked<Fields> {
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])]
  let clashed = false
  const value: Fields = {}
  for (const key of keys) {
    const one = picked(under(base, key), mine[key], theirs[key], mineWins)
    clashed ||= one.clashed
    if (one.value !== undefined) value[key] = one.value
  }
  return { value, clashed }
}

function picked(base: Base, mine: unknown, theirs: unknown, mineWins: boolean): Picked<unknown> {
  if (same(mine, theirs)) return { value: mine, clashed: false }
  if (base !== UNKNOWN && same(base, mine)) return { value: theirs, clashed: false }
  if (base !== UNKNOWN && same(base, theirs)) return { value: mine, clashed: false }
  if (isFields(mine) && isFields(theirs)) return pickedFields(base, mine, theirs, mineWins)
  if (isListById(mine) && isListById(theirs)) return pickedList(base, mine, theirs, mineWins)
  return { value: mineWins ? mine : theirs, clashed: true }
}

function pickedContent(
  base: Content | null,
  mine: Content,
  theirs: Content,
  mineWins: boolean,
): Picked<Content> {
  if (mine.kind !== theirs.kind) {
    return { value: mineWins ? mine : theirs, clashed: true }
  }
  const was: Base = base?.kind === mine.kind ? base : UNKNOWN
  const one = pickedFields(was, mine as unknown as Fields, theirs as unknown as Fields, mineWins)
  return { value: one.value as unknown as Content, clashed: one.clashed }
}

export function mergedFields<T extends object>(base: T | null, mine: T, theirs: T): T {
  const was: Base = base ?? UNKNOWN
  return pickedFields(was, mine as unknown as Fields, theirs as unknown as Fields, true).value as T
}

function pickedOne<T>(base: Base, mine: T, theirs: T, mineWins: boolean): T {
  return picked(base, mine, theirs, mineWins).value as T
}

export function mergedAttachments(
  base: readonly Attachment[] | null,
  mine: readonly Attachment[],
  theirs: readonly Attachment[],
): Attachment[] {
  const had = new Set((base ?? []).map((one) => one.id))
  const kept = (side: readonly Attachment[]) => new Set(side.map((one) => one.id))
  const mineIds = kept(mine)
  const theirIds = kept(theirs)
  const out = new Map<string, Attachment>()
  for (const one of [...mine, ...theirs]) {
    const removed = had.has(one.id) && (!mineIds.has(one.id) || !theirIds.has(one.id))
    if (!removed && !out.has(one.id)) out.set(one.id, one)
  }
  return [...out.values()]
}

function laterOf(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

export function mergedEnvelope(base: Envelope | null, mine: Envelope, theirs: Envelope): Merged {
  const mineWins = mine.modified >= theirs.modified
  const was = (key: keyof Envelope): Base => (base === null ? UNKNOWN : base[key])
  const content = pickedContent(base?.content ?? null, mine.content, theirs.content, mineWins)
  const loserSide: Side = mineWins ? 'theirs' : 'mine'
  const loser = mineWins ? theirs.content : mine.content
  const envelope: Envelope = {
    v: 1,
    content: content.value,
    folder: pickedOne(was('folder'), mine.folder, theirs.folder, mineWins),
    trashed: pickedOne(was('trashed'), mine.trashed, theirs.trashed, mineWins),
    pinned: pickedOne(was('pinned'), mine.pinned, theirs.pinned, mineWins),
    monitored: pickedOne(was('monitored'), mine.monitored, theirs.monitored, mineWins),
    attachments: mergedAttachments(base?.attachments ?? null, mine.attachments, theirs.attachments),
    created: Math.min(mine.created, theirs.created),
    modified: Math.max(mine.modified, theirs.modified),
    used: laterOf(mine.used, theirs.used),
  }
  const lost = content.clashed && !same(loser, envelope.content) ? loserSide : null
  return { envelope, lost }
}
