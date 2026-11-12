import type { Env } from './types'

const OPEN_FOR = 24 * 60 * 60 * 1000

const ASKED_AT_ONCE = 10

export const OPEN_HEADER = 'x-orden-open'
interface OpenAnswer {
  open: boolean
}

type Table = { name: 'room_sockets'; key: 'note_id' } | { name: 'chat_sockets'; key: 'chat_id' }

export async function sweepOpened(
  env: Env,
  table: Table,
  stillOpen: (id: string, who: string) => Promise<boolean | null>,
): Promise<void> {
  const before = Date.now() - OPEN_FOR
  const { results } = await env.DB.prepare(
    `select ${table.key} as id, who from ${table.name}
      where opened_at < ? order by opened_at limit ?`,
  )
    .bind(before, ASKED_AT_ONCE)
    .all<{ id: string; who: string }>()

  await Promise.all(
    results.map(async ({ id, who }) => {
      const open = await stillOpen(id, who).catch(() => null)
      const where = `${table.key} = ? and who = ? and opened_at < ?`
      if (open === false) {
        await env.DB.prepare(`delete from ${table.name} where ${where}`).bind(id, who, before).run()
      } else {
        await env.DB.prepare(`update ${table.name} set opened_at = ? where ${where}`)
          .bind(Date.now(), id, who, before)
          .run()
      }
    }),
  )
}

export function openAnswer(open: boolean): Response {
  return Response.json({ open } satisfies OpenAnswer)
}

export async function openIn(answer: Response | null): Promise<boolean | null> {
  if (!answer?.ok) return null
  const body: unknown = await answer.json().catch(() => null)
  if (typeof body !== 'object' || body === null) return null
  const open = (body as Partial<OpenAnswer>).open
  return typeof open === 'boolean' ? open : null
}
