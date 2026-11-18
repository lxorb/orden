import { Hono } from 'hono'
import {
  type Env,
  listIn,
  LONGEST_PATH,
  NOT_AN_OBJECT,
  objectBody,
  staysInside,
  type Variables,
} from '../../../sync-server/src/api'
import { fits, writeColumn } from './columns'
import { atLeast, spaceOf } from './space'

const MOST = 200

function inside(path: unknown): path is string {
  return (
    typeof path === 'string' && path.length > 0 && path.length <= LONGEST_PATH && staysInside(path)
  )
}

function wrong(value: unknown): string | null {
  if (!Array.isArray(value)) return 'excluded must be a list'
  if (value.length > MOST) return `a space leaves out at most ${MOST} paths`
  return null
}

function pathsOf(value: readonly unknown[]): string[] {
  const out: string[] = []

  for (const one of value) {
    if (out.length >= MOST) break
    if (inside(one) && !out.includes(one)) out.push(one)
  }

  return out
}

export function readExcluded(raw: string): string[] {
  const held = listIn(raw)
  return held ? pathsOf(held) : []
}

export const spaceExcluded = new Hono<{ Bindings: Env; Variables: Variables }>()

spaceExcluded.put('/:id/excluded', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sent = body.excluded
  const problem = wrong(sent)
  if (problem) return context.json({ error: problem }, 400)

  const kept = pathsOf(sent as readonly unknown[])
  const written = JSON.stringify(kept)
  if (!fits(written, 'excluded')) {
    return context.json({ error: 'that is more paths than a space leaves out' }, 413)
  }

  await writeColumn(context.env, 'excluded', space.id, written)

  return context.json({ excluded: kept })
})
