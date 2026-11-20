import { portOf, runCommand } from '@orden/contracts'
import { DIVIDER, type MenuEntry } from '../../ui-kit/src/api'
import { views } from '../../panes/src/api'

const GROUPS: readonly (readonly string[])[] = [
  ['read-only', 'reading'],
  ['source', 'focus', 'typewriter'],
  ['view.fold', 'view.fold-all', 'view.fold-more', 'view.fold-less', 'view.unfold-all'],
]
export async function noteMenu(paneId: string): Promise<MenuEntry[]> {
  const commands = portOf('commands.app')
  const rows = commands.ok ? await commands.value.rows(views.of(paneId)) : []
  const byId = new Map(rows.map((one) => [one.id, one]))
  const pick = (ids: readonly string[]) => ids.flatMap((id) => byId.get(id) ?? [])
  return [
    ...pick(['history', 'print']),
    { label: 'Export', asks: true, run: () => void runCommand('export.picker') },
    ...GROUPS.flatMap((ids) => [DIVIDER, ...pick(ids)]),
  ]
}
