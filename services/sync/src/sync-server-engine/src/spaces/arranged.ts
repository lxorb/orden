import { LONGEST_PATH, objectIn, staysInside } from '../../../sync-server/src/api'
import { columnRoute } from './space'

const MOST_FOLDERS = 200

const MOST_NAMES = 500

const LONGEST_NAME = 255

export function isName(value: string): boolean {
  if (!value || value.length > LONGEST_NAME) return false
  if (value === '.' || value === '..') return false
  if (/\p{Cc}/u.test(value)) return false

  return !value.includes('/') && !value.includes('\\')
}

function inside(path: string): boolean {
  return path.length <= LONGEST_PATH && staysInside(path)
}

function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'arranged must be a map'
  if (Object.keys(value).length > MOST_FOLDERS) {
    return `arranged holds at most ${MOST_FOLDERS} folders`
  }

  return null
}

function namesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const out: string[] = []

  for (const one of value) {
    if (out.length >= MOST_NAMES) break
    if (typeof one !== 'string' || !isName(one) || seen.has(one)) continue

    seen.add(one)
    out.push(one)
  }

  return out
}

function arrangedMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const kept: [string, string[]][] = []

  for (const [path, listed] of Object.entries(value)) {
    if (kept.length >= MOST_FOLDERS) break
    if (!inside(path)) continue

    const names = namesOf(listed)
    if (names.length) kept.push([path, names])
  }

  return Object.fromEntries(kept)
}

export function readArranged(raw: string): Record<string, string[]> {
  return arrangedMap(objectIn(raw))
}

export const spaceArranged = columnRoute(
  'arranged',
  wrong,
  arrangedMap,
  'that is more arranged folders than a space holds',
)
