import { TEXT } from '@orden/rooms'
import { padEdits, textops, type PadAnswer, type PadTrade } from '@orden/sync-core'
import * as Y from 'yjs'
import type { Edit } from '@orden/scan/search/replace'
import { isRecord } from '../../platform/src/api'
import { joined } from './words'

export interface PadServer {
  trade(trade: PadTrade): Promise<PadAnswer | null>
}

export interface PadDisk {
  read(key: string): Promise<unknown>
  keep(key: string, value: unknown): Promise<void>
}

export interface PadText {
  now(): Promise<string>
  takeIn(
    change: (now: string) => readonly Edit[],
    settle: (after: string) => Promise<void>,
  ): Promise<void>
}

type InTurn = <T>(name: string, run: () => Promise<T>) => Promise<T>

type Traded = 'synced' | 'local'

interface Kept {
  doc: Uint8Array
  server: Uint8Array
  wrote?: string
  before?: Uint8Array
  beforeServer?: Uint8Array
}

interface Last {
  owner: string
  text: string
}

const LAST = 'last'

const MOST_ROUNDS = 4

const NOTHING = Y.encodeStateVector(new Y.Doc())

function keptOf(value: unknown): Kept | null {
  if (!isRecord(value) || !(value.doc instanceof Uint8Array)) return null
  if (!(value.server instanceof Uint8Array)) return null
  const kept: Kept = { doc: value.doc, server: value.server }
  if (
    typeof value.wrote === 'string' &&
    value.before instanceof Uint8Array &&
    value.beforeServer instanceof Uint8Array
  ) {
    kept.wrote = value.wrote
    kept.before = value.before
    kept.beforeServer = value.beforeServer
  }
  return kept
}

function lastOf(value: unknown): Last | null {
  return isRecord(value) && typeof value.owner === 'string' && typeof value.text === 'string'
    ? { owner: value.owner, text: value.text }
    : null
}

function folded(words: Y.Text, to: string): boolean {
  const from = words.toJSON()
  if (from === to) return false
  textops(words, from, to)
  return true
}

function covers(server: Uint8Array, mine: Uint8Array): boolean {
  const theirs = Y.decodeStateVector(server)
  for (const [client, clock] of Y.decodeStateVector(mine)) {
    if ((theirs.get(client) ?? 0) < clock) return false
  }
  return true
}

function carried(words: Y.Text, now: string, last: Last | null, owner: string): boolean {
  const mine = last && last.owner !== owner && now === last.text ? '' : now
  const theirs = words.toJSON()
  if (!mine.trim() || mine.trim() === theirs.trim()) return false
  return folded(words, theirs.trim() ? joined(theirs, mine) : mine)
}

export class PadSync {
  constructor(
    private readonly text: PadText,
    private readonly disk: PadDisk,
    private readonly inTurn: InTurn,
  ) {}

  exchange(owner: string, server: PadServer): Promise<Traded> {
    return this.inTurn(`orden:pad:${owner}`, () => this.traded(owner, server))
  }

  left(owner: string): Promise<void> {
    return this.inTurn(`orden:pad:${owner}`, async () => {
      await this.disk.keep(LAST, { owner, text: await this.text.now() })
    })
  }

  private async traded(owner: string, server: PadServer): Promise<Traded> {
    const kept = keptOf(await this.disk.read(owner))
    const last = lastOf(await this.disk.read(LAST))
    const now = await this.text.now()

    const doc = new Y.Doc()
    let sent = kept?.server ?? NOTHING
    if (kept?.wrote !== undefined && kept.before && kept.beforeServer && now !== kept.wrote) {
      Y.applyUpdateV2(doc, kept.before)
      sent = kept.beforeServer
    } else if (kept) {
      Y.applyUpdateV2(doc, kept.doc)
    }
    const words = doc.getText(TEXT)

    let joining = !kept || last?.owner !== owner
    if (!joining && folded(words, now)) await this.keep(owner, { doc, server: sent })

    for (let round = 0; round < MOST_ROUNDS; round++) {
      const answer = await server.trade({
        sv: Y.encodeStateVector(doc),
        update: Y.encodeStateAsUpdateV2(doc, sent),
      })
      if (!answer) return 'local'

      const before = Y.encodeStateAsUpdateV2(doc)
      const beforeServer = sent
      const round = { more: false }
      await this.text.takeIn(
        (now) => {
          if (!joining) round.more = folded(words, now)
          Y.applyUpdateV2(doc, answer.update)
          if (joining) round.more = carried(words, now, last, owner)
          joining = false
          return padEdits(now, words.toJSON())
        },
        (after) => this.keep(owner, { doc, server: answer.sv, wrote: after, before, beforeServer }),
      )
      sent = answer.sv
      await this.keep(owner, { doc, server: sent })
      await this.disk.keep(LAST, { owner, text: words.toJSON() })

      if (!round.more && covers(answer.sv, Y.encodeStateVector(doc))) break
    }
    return 'synced'
  }

  private keep(owner: string, held: Omit<Kept, 'doc'> & { doc: Y.Doc }): Promise<void> {
    const { doc, ...rest } = held
    return this.disk.keep(owner, { ...rest, doc: Y.encodeStateAsUpdateV2(doc) })
  }
}
