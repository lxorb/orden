import { noteKey } from '../notes'
import { keepPictures } from '../pictures'
import type { Env } from '../types'
import { FRONT_REV, titleFrom, writeFront } from './front'
import { keepWords } from './words'

const AT_ONCE = 200

export async function fillFronts(env: Env, spaceId: string | null): Promise<number> {
  const asking = spaceId
    ? env.DB.prepare(
        `select id, space_id, path from notes
          where (front is null or front_rev < ?) and (deleted = 0 or size > 0)
            and kind != 'file' and space_id = ?
          limit ?`,
      ).bind(FRONT_REV, spaceId, AT_ONCE)
    : env.DB.prepare(
        `select n.id, n.space_id, n.path from notes n join spaces s on s.id = n.space_id
          where (n.front is null or n.front_rev < ?) and (n.deleted = 0 or n.size > 0)
            and n.kind != 'file'
          order by n.front is null desc, s.blog_enabled desc
          limit ?`,
      ).bind(FRONT_REV, AT_ONCE)

  const { results } = await asking.all<{ id: string; space_id: string; path: string }>()
  if (!results.length) return 0

  const writes = await Promise.all(
    results.map(async (row) => {
      const object = await env.NOTES.get(noteKey(row.space_id, row.id))
      const source = object ? await object.text() : ''

      await keepWords(env, row, source, titleFrom(row.path, source)).catch(() => undefined)
      const kept = await keepPictures(env, row, source)

      return env.DB.prepare('update notes set front = ?, front_rev = ? where id = ?').bind(
        writeFront(source),
        kept ? FRONT_REV : 0,
        row.id,
      )
    }),
  )

  await env.DB.batch(writes)
  return results.length
}
