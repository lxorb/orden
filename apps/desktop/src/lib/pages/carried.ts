import { readCanvas } from '@orden/markdown/canvas'
import { pagesOf } from '@orden/markdown/pages'
import { ApiError } from '../api'
import { nameOf } from '../space-paths'
import { paperOf } from './held'

export interface Carried {
  path: string
  id: string
  writes: boolean
  space: string
}

export interface Carrying {
  exists(path: string): Promise<boolean>
  stamp(path: string): Promise<string | null>
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array): Promise<void>
  text(path: string): Promise<string | null>
  hash(bytes: Uint8Array): Promise<string>
  up(hash: string, bytes: Uint8Array): Promise<void>
  hold(id: string, hash: string): Promise<void>
  down(id: string): Promise<Uint8Array | null>
  carried: Map<string, string>
  kept(): void
  said(note: Carried, failed: string): void
}

const lacking = new Map<string, number>()

const ASK_AGAIN = 60_000

const settled = new Set<string>()

const refused = new Map<string, string>()

const failing = new Map<string, { tries: number; until: number; said: boolean }>()

function failingOf(id: string) {
  const one = failing.get(id) ?? { tries: 0, until: 0, said: false }
  failing.set(id, one)
  return one
}

function sayOnce(note: Carried, failed: string, how: Carrying) {
  const one = failingOf(note.id)
  if (one.said) return
  one.said = true
  how.said(note, failed)
}

let notSignedInUntil = 0

const REFUSALS: ReadonlySet<number> = new Set([400, 413, 415])

export function paperRetryDelay(tries: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, tries - 1), 600_000)
}

export async function carryPapers(notes: readonly Carried[], how: Carrying): Promise<void> {
  for (const note of notes) {
    if (Date.now() < notSignedInUntil) return
    if (Date.now() < (failing.get(note.id)?.until ?? 0)) continue
    try {
      await carryOne(note, how)
      failing.delete(note.id)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        notSignedInUntil = Date.now() + paperRetryDelay(1)
        return
      }
      const one = failingOf(note.id)
      one.tries += 1
      one.until = Date.now() + paperRetryDelay(one.tries)
      if (error instanceof ApiError && error.status === 507) {
        sayOnce(note, `no room on the account for ${nameOf(paperOf(note.path))}`, how)
      }
    }
  }
}

async function carryOne(note: Carried, how: Carrying): Promise<void> {
  const key = `${note.id}\n${note.path}`
  if (settled.has(key) || Date.now() - (lacking.get(note.id) ?? -ASK_AGAIN) < ASK_AGAIN) return
  const paper = paperOf(note.path)

  if (await how.exists(paper)) {
    if (!how.carried.has(note.id) && note.writes) {
      const stamp = await how.stamp(paper)
      if (refused.get(note.id) === stamp) return
      const bytes = await how.read(paper)
      if (!bytes?.byteLength) return
      const hash = await how.hash(bytes)
      try {
        await how.up(hash, bytes)
      } catch (error) {
        if (!(error instanceof ApiError && REFUSALS.has(error.status))) throw error
        const failed = `the account would not take ${nameOf(paper)}`
        if (stamp === null) {
          sayOnce(note, failed, how)
          throw error
        }
        refused.set(note.id, stamp)
        how.said(note, failed)
        return
      }
      await how.hold(note.id, hash)
      refused.delete(note.id)
      how.carried.set(note.id, hash)
      how.kept()
    }
    settled.add(key)
    return
  }

  if (!namesAPaper(await how.text(note.path))) {
    settled.add(key)
    return
  }
  const bytes = await how.down(note.id)
  if (!bytes) {
    lacking.set(note.id, Date.now())
    return
  }
  if (!(await stillWanted(note.path, paper, how))) return
  await how.write(paper, bytes)
  how.carried.set(note.id, await how.hash(bytes))
  how.kept()
  settled.add(key)
}

async function stillWanted(
  note: string,
  paper: string,
  how: Pick<Carrying, 'exists'>,
): Promise<boolean> {
  return (await how.exists(note)) && !(await how.exists(paper))
}

export function namesAPaper(text: string | null): boolean {
  if (!text) return false
  try {
    return pagesOf(readCanvas(text)).some((page) => !!page.file)
  } catch {
    return false
  }
}

export async function paperFor(
  id: string,
  note: string | null,
  how: Pick<Carrying, 'exists' | 'down' | 'write' | 'hash' | 'carried' | 'kept'>,
): Promise<Uint8Array | null> {
  const bytes = await how.down(id).catch(() => null)
  if (!bytes) return null
  if (note && (await stillWanted(note, paperOf(note), how))) {
    await how.write(paperOf(note), bytes)
    how.carried.set(id, await how.hash(bytes))
    how.kept()
  }
  return bytes
}

export function forgetLacking(): void {
  lacking.clear()
  settled.clear()
  refused.clear()
  failing.clear()
  notSignedInUntil = 0
}
