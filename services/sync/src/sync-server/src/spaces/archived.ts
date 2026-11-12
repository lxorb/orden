import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody, objectIn } from '../body'
import { fits, writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { LONGEST_PATH, staysInside } from './paths'
import { atLeast, spaceOf } from './space'

const MOST = 1000

function kept(path: string, when: unknown): when is number {
  return (
    path.length > 0 &&
    path.length <= LONGEST_PATH &&
    staysInside(path) &&
    typeof when === 'number' &&
    Number.isSafeInteger(when) &&
    when !== 0
  )
}

function wrong(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'archived must be a map'
  if (Object.keys(value).length > MOST) return `a space keeps at most ${MOST} archived paths`
  return null
}

function archivedMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const out: [string, number][] = []
  for (const [path, when] of Object.entries(value)) {
    if (out.length >= MOST) break
    if (kept(path, when)) out.push([path, when])
  }

  return Object.fromEntries(out)
}

export function readArchived(raw: string): Record<string, number> {
  return archivedMap(objectIn(raw))
}

export const spaceArchived = new Hono<{ Bindings: Env; Variables: Variables }>()

spaceArchived.put('/:id/archived', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.archived
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  const map = archivedMap(sent)
  const written = JSON.stringify(map)
  if (!fits(written, 'archived')) {
    return context.json({ error: 'that is more archived paths than a space holds' }, 413)
  }

  await writeColumn(context.env, 'archived', space.id, written)

  return context.json({ archived: map })
})
