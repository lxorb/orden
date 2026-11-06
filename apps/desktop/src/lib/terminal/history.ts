import { writing } from '../parting'
import { forget, isNumber, isRecord, isString, stored } from '../stored'
import { invoke } from '../tauri'

export interface History {
  cols: number
  rows: number
  at: number
  text: string
}

export interface Place {
  space: string | null
  key: string
}

export const LINES = 1000

export const MOST = 512 * 1024

export function fitted(serialize: (lines: number) => string, most = MOST): string | null {
  for (let lines = LINES; ; lines = Math.floor(lines / 2)) {
    const text = serialize(lines)
    if (text.length <= most) return text
    if (lines === 0) return null
  }
}

export function restoredLine(words: string): string {
  return `\x1b[0m\r\n${dim(words)}`
}

export function restoredAbove(words: string, rows: number): string {
  return `\x1b[0m\r\n${'\r\n'.repeat(Math.max(0, rows - 1))}\x1b[H${dim(words)}`
}

function dim(words: string): string {
  return `\x1b[2m${words}\x1b[22m\r\n`
}

function readHistory(value: unknown): History | null {
  if (!isRecord(value)) return null
  const { cols, rows, at, text } = value
  if (!isNumber(cols) || !isNumber(rows) || !isNumber(at) || !isString(text) || !text) return null
  return { cols, rows, at, text }
}

const closed = new Map<string, History>()

const KEPT_CLOSED = 12

const turns = new Map<string, Promise<void>>()

function inTurn(key: string, run: () => Promise<unknown>): Promise<void> {
  const mine = (turns.get(key) ?? Promise.resolve()).then(run).then(
    () => undefined,
    () => undefined,
  )
  turns.set(key, mine)
  void mine.then(() => {
    if (turns.get(key) === mine) turns.delete(key)
  })
  writing(mine)
  return mine
}

export async function historyOf(place: Place): Promise<History | null> {
  if (!place.key) return null

  const kept = closed.get(place.key)
  if (kept) {
    closed.delete(place.key)
    return kept
  }

  await turns.get(place.key)
  const found = await invoke<unknown>('terminal_history_read', {
    space: place.space,
    key: place.key,
  }).catch(() => null)
  return readHistory(found)
}

export async function peekHistory(place: Place): Promise<History | null> {
  if (!place.key) return null
  const kept = closed.get(place.key)
  if (kept) return kept
  await turns.get(place.key)
  const found = await invoke<unknown>('terminal_history_read', {
    space: place.space,
    key: place.key,
  }).catch(() => null)
  return readHistory(found)
}

export function keepHistory(place: Place, history: History): void {
  if (!place.key) return
  void inTurn(place.key, () =>
    invoke('terminal_history_write', { space: place.space, key: place.key, history }),
  )
}

export function dropHistory(place: Place, last: History | null): void {
  if (!place.key) return

  if (last) {
    closed.delete(place.key)
    closed.set(place.key, last)
    for (const key of closed.keys()) {
      if (closed.size <= KEPT_CLOSED) break
      closed.delete(key)
    }
  }

  void inTurn(place.key, () =>
    invoke('terminal_history_forget', { space: place.space, key: place.key }),
  )
}

export function moveHistory(from: Place, to: Place): void {
  if (!from.key || from.space === to.space) return
  void inTurn(from.key, async () => {
    const found = readHistory(
      await invoke<unknown>('terminal_history_read', { space: from.space, key: from.key }),
    )
    if (found) {
      await invoke('terminal_history_write', { space: to.space, key: to.key, history: found })
    }
    await invoke('terminal_history_forget', { space: from.space, key: from.key })
  })
}

export function forgetHistories(): void {
  closed.clear()
  const before = Promise.all(turns.values())
  writing(
    before
      .then(() => invoke('terminal_history_forget', { space: null, key: null }))
      .catch(() => undefined),
  )
}

const LEGACY = 'nib:terminal-lines'

export function moveLegacy(open: readonly Place[]): void {
  const value = stored(LEGACY)
  if (value === null) return
  forget(LEGACY)
  if (!isRecord(value)) return

  for (const place of open) {
    const one = place.key ? value[place.key] : undefined
    if (!isRecord(one) || !isString(one.text) || !one.text) continue
    keepHistory(place, {
      cols: 0,
      rows: 0,
      at: isNumber(one.at) ? one.at : Date.now(),
      text: one.text,
    })
  }
}
