import type { Who } from '@orden/chats'
import type { Presence } from '../../../accounts/src/api'
import type { ChatMember } from '../shapes'

const RANKS = ['owner', 'member', 'bot'] as const

export type Rank = (typeof RANKS)[number]

export interface Listed {
  who: Who
  name: string
  rank: Rank
  presence: Presence | null
}

export interface Group {
  rank: Rank
  members: Listed[]
}

export type Line = { kind: 'group'; rank: Rank; count: number } | { kind: 'member'; member: Listed }

function rankOf(member: ChatMember): Rank {
  if (member.who.startsWith('program:')) return 'bot'
  return member.role === 'owner' ? 'owner' : 'member'
}

export function listedOf(
  members: readonly ChatMember[],
  name: (who: Who) => string,
  presence: (who: Who) => Presence | null,
): Listed[] {
  return members.map((one) => ({
    who: one.who,
    name: name(one.who),
    rank: rankOf(one),
    presence: presence(one.who),
  }))
}

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

function matches(member: Listed, filter: string): boolean {
  const wanted = fold(filter.trim())
  if (!wanted) return true
  return fold(member.name).includes(wanted)
}

const ORDER: Record<Presence, number> = { active: 0, away: 1, offline: 2 }

function standing(member: Listed): number {
  return member.presence ? ORDER[member.presence] : 2
}

export function grouped(list: readonly Listed[], filter = ''): Group[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  const kept = list.filter((one) => matches(one, filter))
  return RANKS.flatMap((rank) => {
    const members = kept
      .filter((one) => one.rank === rank)
      .sort((a, b) => standing(a) - standing(b) || collator.compare(a.name, b.name))
    return members.length ? [{ rank, members }] : []
  })
}

export function linesOf(groups: readonly Group[]): Line[] {
  return groups.flatMap((group): Line[] => [
    { kind: 'group', rank: group.rank, count: group.members.length },
    ...group.members.map((member) => ({ kind: 'member' as const, member })),
  ])
}

export interface Placed {
  line: Line
  top: number
  height: number
}

export function placed(
  lines: readonly Line[],
  heights: { group: number; member: number },
): { rows: Placed[]; total: number } {
  let top = 0
  const rows = lines.map((line) => {
    const height = line.kind === 'group' ? heights.group : heights.member
    const row = { line, top, height }
    top += height
    return row
  })
  return { rows, total: top }
}

export function visible(rows: readonly Placed[], from: number, to: number): Placed[] {
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >> 1
    const row = rows[middle]
    if (row && row.top + row.height <= from) low = middle + 1
    else high = middle
  }
  const shown: Placed[] = []
  for (let at = low; at < rows.length; at++) {
    const row = rows[at]
    if (!row || row.top >= to) break
    shown.push(row)
  }
  return shown
}
