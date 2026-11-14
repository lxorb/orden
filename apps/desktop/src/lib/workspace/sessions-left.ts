import { unixLines } from './documents.svelte'
import { type Draft, readClosed, readDraft } from './session'
import { ifFree, locksHere, locksWork, log, isNumber, isRecord } from '../platform/src/api'
import { leftLately, slotLock, slotOf } from './slot'
import { TAB_KINDS } from './tab-kinds'
import { mergedOver } from './unwritten'

function wordsOnly(one: Draft): boolean {
  if (!TAB_KINDS[one.kind].words) return false
  return one.dirty || (one.path === null && one.doc.trim() !== '')
}

function parted(value: unknown, found: Draft[]): unknown {
  if (Array.isArray(value)) return value.map((one) => parted(one, found))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const [name, field] of Object.entries(value)) {
    if (name === 'tabs' && Array.isArray(field)) Object.assign(out, strip(value, field, found))
    else if (name === 'closed' && Array.isArray(field)) out[name] = stack(field, found)
    else if (name !== 'active' && name !== 'recent') out[name] = parted(field, found)
    else if (!Array.isArray(value.tabs)) out[name] = field
  }
  return out
}

function strip(pane: Record<string, unknown>, tabs: unknown[], found: Draft[]) {
  const moved = new Map<number, number>()
  const kept: unknown[] = []
  tabs.forEach((one, at) => {
    const draft = readDraft(one)
    if (draft && wordsOnly(draft)) {
      found.push(draft)
      return
    }
    moved.set(at, kept.length)
    kept.push(one)
  })
  const active = isNumber(pane.active) ? pane.active : 0
  const next = tabs.findIndex((_, at) => at >= active && moved.has(at))
  return {
    tabs: kept,
    ...('active' in pane ? { active: moved.get(next) ?? Math.max(kept.length - 1, 0) } : {}),
    ...(Array.isArray(pane.recent)
      ? {
          recent: pane.recent.flatMap((at: unknown) => {
            const to = isNumber(at) ? moved.get(at) : undefined
            return to === undefined ? [] : [to]
          }),
        }
      : {}),
  }
}

function stack(closed: unknown[], found: Draft[]): unknown[] {
  return closed.filter((one) => {
    const entry = readClosed(one)
    if (!entry || entry.trashed !== undefined || !wordsOnly(entry.draft)) return true
    found.push(entry.draft)
    return false
  })
}

function others(storage: Storage, mine: number): { key: string; slot: number }[] {
  const out: { key: string; slot: number }[] = []
  for (let at = 0; at < storage.length; at += 1) {
    const key = storage.key(at)
    const slot = key === null ? null : slotOf(key)
    if (key !== null && slot !== null && slot !== mine) out.push({ key, slot })
  }
  return out
}

export async function takeSessionsLeft(
  mine: number,
  take: (drafts: Draft[]) => Promise<void>,
  storage: Storage = localStorage,
  locks = locksHere(),
  now = Date.now(),
): Promise<boolean> {
  if (!locks || !(await locksWork(locks))) return false
  let waiting = false
  for (const { key, slot } of others(storage, mine)) {
    if (leftLately(slot, storage, now)) {
      waiting = true
      continue
    }
    let working: Promise<void> = Promise.resolve()
    const work = async () => {
      const drafts: Draft[] = []
      const rest = parted(parsed(storage.getItem(key)), drafts)
      if (drafts.length) await take(drafts)
      if (slot !== 0) storage.removeItem(key)
      else if (drafts.length) storage.setItem(key, JSON.stringify(rest))
    }
    await ifFree(locks, slotLock(slot), () => (working = work()))
    await working.catch((error: unknown) => {
      log('warn', `session: ${key} stays - ${String(error)}`)
    })
  }
  return waiting
}

export async function asDrafts(
  drafts: readonly Draft[],
  says: (path: string) => Promise<string | null>,
  spaceOf: (path: string) => string | null = () => null,
): Promise<Draft[]> {
  const out: Draft[] = []
  for (const [at, draft] of drafts.entries()) {
    if (draft.path === null) {
      out.push(draft)
      continue
    }
    if (await saidBeside(draft, at, drafts)) continue
    if (await saidThere(draft, await says(draft.path))) continue
    const space = spaceOf(draft.path)
    const made: Draft = { ...draft, path: null, dirty: true, ...(space ? { space } : {}) }
    delete made.share
    delete made.base
    out.push(made)
  }
  return out
}

async function saidBeside(draft: Draft, at: number, drafts: readonly Draft[]): Promise<boolean> {
  if (draft.share === undefined) return false
  for (const [there, other] of drafts.entries()) {
    if (there === at || other.share !== draft.share || other.path === null) continue
    if (other.doc !== draft.doc && !(await saidThere(draft, other.doc))) continue
    if (there < at || !(await saidThere(other, draft.doc))) return true
  }
  return false
}

async function saidThere(draft: Draft, read: string | null): Promise<boolean> {
  if (read === null) return false
  const disk = unixLines(read)
  const words = unixLines(draft.doc)
  if (disk === words) return true
  if (draft.base === undefined || draft.kind !== 'note') return false
  return (await mergedOver(unixLines(draft.base), words, disk)) === disk
}

function parsed(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text)
  } catch {
    return null
  }
}
