import { type Os, onTheList, osOf, startsOnlyOne } from './shell-text'

export function shellOs(online: boolean, platform: string): Os {
  return online ? 'unix' : osOf(platform)
}

const KEYS: Record<string, string> = {
  Enter: '\r',
  Tab: '\t',
  Escape: '\x1b',
  Backspace: '\x7f',
  Up: 'A',
  Down: 'B',
  Right: 'C',
  Left: 'D',
  'Ctrl+C': '\x03',
  'Ctrl+D': '\x04',
  'Ctrl+L': '\x0c',
  'Ctrl+Z': '\x1a',
}

export const KEY_NAMES = Object.keys(KEYS)

const ARROWS = new Set(['Up', 'Down', 'Right', 'Left'])

const FREE = new Set(['Ctrl+C'])

export function keyBytes(
  names: readonly string[],
  applicationCursor: boolean,
): { bytes: string } | { unknown: string } {
  let bytes = ''
  for (const name of names) {
    const sent = KEYS[name]
    if (sent === undefined) return { unknown: name }
    bytes += ARROWS.has(name) ? `${applicationCursor ? '\x1bO' : '\x1b['}${sent}` : sent
  }

  return { bytes }
}

export function typesFreely(
  text: string,
  enter: boolean,
  keys: readonly string[],
  programs: readonly string[],
  os: Os,
): boolean {
  if (!text && !enter) return keys.length > 0 && keys.every((name) => FREE.has(name))
  if (keys.length || !enter || !text.trim() || !startsOnlyOne(text)) return false

  return onTheList(text, programs, os)
}

export interface Row {
  isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

export function linesOf(
  rows: { length: number; getLine(at: number): Row | undefined },
  from: number,
  most: number,
): { text: string; truncated: boolean } {
  const lines: string[] = []
  for (let at = Math.max(0, from); at < rows.length; at++) {
    const row = rows.getLine(at)
    if (!row) continue

    const words = row.translateToString(true)
    const last = lines.length - 1
    if (row.isWrapped && last >= 0) lines[last] = `${lines[last] ?? ''}${words}`
    else lines.push(words)
  }

  while (lines.length && !lines[lines.length - 1]?.trim()) lines.pop()
  const truncated = lines.length > most
  return { text: (truncated ? lines.slice(-most) : lines).join('\n'), truncated }
}

interface Rows {
  length: number
  baseY: number
  cursorY: number
  getLine(at: number): Row | undefined
}

interface Marker {
  readonly line: number
  readonly isDisposed: boolean
  dispose(): void
}

interface Screen {
  buffer: { active: Rows; normal: Rows }
  registerMarker(offset?: number): Marker | undefined
}

export function linesFrom(term: Screen): (most: number) => { text: string; truncated: boolean } {
  const rows = term.buffer.active
  const mark = rows === term.buffer.normal ? term.registerMarker(0) : undefined
  const from = rows.baseY + rows.cursorY

  return (most) => {
    const now = term.buffer.active
    if (now !== rows) return linesOf(now, 0, most)
    if (!mark) return linesOf(now, from, most)

    const lost = mark.isDisposed
    const read = linesOf(now, lost ? 0 : mark.line, most)
    mark.dispose()
    return lost ? { ...read, truncated: true } : read
  }
}
