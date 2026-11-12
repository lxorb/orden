import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'
import { deviceOf } from '../sync2/device'
import { v1Wrote } from '../sync2/maps'

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

export const spaceArranged = new Hono<{ Bindings: Env; Variables: Variables }>()

spaceArranged.put('/:id/arranged', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.arranged
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  const kept = arrangedMap(sent)
  const written = JSON.stringify(kept)
  if (!fits(written, 'arranged')) {
    return context.json({ error: 'that is more arranged folders than a space holds' }, 413)
  }

  await writeColumn(context.env, 'arranged', space.id, written)
  await v1Wrote(context.env, space, 'order', kept, await deviceOf(context))

  return context.json({ arranged: kept })
})
