/** The palette with nothing typed, as a menu to browse (#304): a few of what was used
 *  lately, then what the note in front offers, how it is shown and what can be made,
 *  each group under its name. The rows are the palette's own commands, picked by id. */

import type { Command } from '../commands'
import { t } from '../i18n.svelte'
import type { Row } from './rows'

/** How many of what was used lately come before the groups. */
export const RECENT = 8

const GROUPS: readonly { title: () => string; ids: readonly string[] }[] = [
  {
    title: () => t('This note'),
    ids: ['rename', 'move-note', 'share-note', 'copy-uri', 'history', 'print', 'reveal'],
  },
  {
    title: () => t('View'),
    ids: ['reading', 'read-only', 'present', 'source', 'focus', 'typewriter'],
  },
  {
    title: () => t('Create'),
    ids: ['new', 'new-canvas', 'new-pages', 'new-from-template', 'new-terminal'],
  },
]

/** The rows, and the name over the group that starts at each place in them. */
export function browse(
  recent: readonly Row[],
  commands: readonly Command[],
): { rows: Row[]; heads: Map<number, string> } {
  const byId = new Map(commands.map((one) => [one.id, one]))
  const rows = [...recent]
  const heads = new Map<number, string>()

  for (const group of GROUPS) {
    const found = group.ids.flatMap((id) => byId.get(id) ?? [])
    if (!found.length) continue
    heads.set(rows.length, group.title())
    rows.push(...found.map((command): Row => ({ kind: 'command', command })))
  }

  return { rows, heads }
}
