import { fold } from '@orden/rooms/fold'
import { unixLines } from './documents.svelte'
import type { Draft } from './session'

export interface Asks {
  read(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  keepVersion(path: string, text: string): Promise<unknown>
  spaceOf(path: string): string | null
  reachable(path: string): Promise<boolean>
}

export interface Back {
  path: string | null
  text: string
  dirty: boolean
  onDisk: string | null
  home: string | null
}

export async function cameBack(draft: Draft & { path: string }, asks: Asks): Promise<Back> {
  const words = unixLines(draft.doc)
  const base = draft.base === undefined ? null : unixLines(draft.base)
  const onFile = (dirty: boolean, onDisk: string | null, text = words): Back => ({
    path: draft.path,
    text,
    dirty,
    onDisk,
    home: null,
  })
  const asDraft = (): Back => ({
    path: null,
    text: words,
    dirty: true,
    onDisk: null,
    home: asks.spaceOf(draft.path),
  })

  const read = await asks.read(draft.path)
  if (read === null) {
    const stays =
      (await asks.exists(draft.path)) || base === null || !(await asks.reachable(draft.path))
    return stays ? onFile(true, base) : asDraft()
  }

  const disk = unixLines(read)
  if (disk === words) return onFile(false, disk)
  if (base === null || disk === base) {
    await asks.keepVersion(draft.path, read).catch(() => undefined)
    return onFile(true, base)
  }
  if (draft.kind !== 'note' || __EVEN_PLUGIN__) return asDraft()

  const merged = await mergedOver(base, words, disk)
  return onFile(merged !== disk, disk, merged)
}

const AROUND = 40

export async function mergedOver(base: string, words: string, disk: string): Promise<string> {
  const typed = fold(base, words)
  if (typed?.insert) {
    const left = base.slice(Math.max(0, typed.from - AROUND), typed.from)
    const right = base.slice(typed.to, typed.to + AROUND)
    if (
      disk.includes(left + typed.insert + right) ||
      (left.length === AROUND && disk.includes(left + typed.insert)) ||
      (right.length === AROUND && disk.includes(typed.insert + right))
    )
      return disk
  }
  if (__EVEN_PLUGIN__) return words
  const { mergedOn } = await import('@orden/sync-core')
  return mergedOn(base, words, disk)
}

export async function wordsOnto(
  draft: Draft,
  kind: Draft['kind'],
  holds: string,
): Promise<string | null> {
  if (draft.base === undefined || draft.kind !== 'note' || kind !== 'note' || __EVEN_PLUGIN__)
    return null
  return mergedOver(unixLines(draft.base), unixLines(draft.doc), holds)
}
