import { Hono } from 'hono'
import { NOT_AN_OBJECT } from '../refused'
import { objectBody } from '../body'
import { writeColumn } from './columns'
import type { Env, Variables } from '../types'
import { atLeast, spaceOf } from './space'

const SORTS = new Set([
  'name',
  'name-desc',
  'modified-desc',
  'modified-asc',
  'created-desc',
  'created-asc',
  'manual',
])

export function readSort(raw: string): string {
  return SORTS.has(raw) ? raw : 'name'
}

export const spaceSort = new Hono<{ Bindings: Env; Variables: Variables }>()

spaceSort.put('/:id/sort', atLeast('write'), async (context) => {
  const space = spaceOf(context)

  const body = await objectBody(context)
  if (!body) return context.json({ error: NOT_AN_OBJECT }, 400)

  const sort = body.sort
  if (typeof sort !== 'string' || !SORTS.has(sort)) {
    return context.json({ error: `sort is one of ${[...SORTS].join(', ')}` }, 400)
  }

  await writeColumn(context.env, 'sort', space.id, sort === 'name' ? '' : sort)
  return context.json({ sort })
})
