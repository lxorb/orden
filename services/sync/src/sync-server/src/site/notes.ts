import type { Env } from '../types'

const ROWS_A_PAGE = 500
const MOST_READ = 50_000
export async function* notesOfSite<Row extends { path: string }>(
  env: Env,
  spaceId: string,
  columns: string,
): AsyncGenerator<Row> {
  let after = ''
  for (let read = 0; read < MOST_READ; read += ROWS_A_PAGE) {
    const { results } = await env.DB.prepare(
      `select ${columns} from notes
        where space_id = ? and deleted = 0 and kind != 'file' and path > ?
        order by path limit ?`,
    )
      .bind(spaceId, after, ROWS_A_PAGE)
      .all<Row>()
    yield* results
    const last = results.at(-1)
    if (!last || results.length < ROWS_A_PAGE) return
    after = last.path
  }
}
