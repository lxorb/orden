import { byteLength, now } from '../crypto'
import type { Env } from '../types'

export type Column =
  'archived' | 'arranged' | 'bookmarks' | 'excluded' | 'files' | 'graph' | 'site' | 'sort'

export const MOST_BYTES: Record<Column | 'icons', number> = {
  sort: 32,
  graph: 4 * 1024,
  bookmarks: 8 * 1024,
  excluded: 16 * 1024,
  site: 24 * 1024,
  files: 32 * 1024,
  icons: 32 * 1024,
  arranged: 32 * 1024,
  archived: 96 * 1024,
}

export function fits(written: string, column: Column | 'icons'): boolean {
  return byteLength(written) <= MOST_BYTES[column]
}

export async function writeColumn(
  env: Env,
  column: Column,
  spaceId: string,
  written: string,
): Promise<void> {
  await env.DB.prepare(`update spaces set ${column} = ?, updated_at = ? where id = ?`)
    .bind(written, now(), spaceId)
    .run()
}
