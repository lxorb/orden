import type { Command } from '../commands'
import { t } from '../i18n.svelte'
import type { Row } from './rows'

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
  {
    title: () => t('Help'),
    ids: ['feedback'],
  },
]

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
