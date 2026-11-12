import { appCommands } from './commands'
import { DIVIDER, type MenuEntry } from './menu.svelte'
import { views } from './views.svelte'

const GROUPS: readonly (readonly string[])[] = [
  ['read-only', 'reading'],
  ['source', 'focus', 'typewriter'],
  ['view.fold', 'view.fold-all', 'view.fold-more', 'view.fold-less', 'view.unfold-all'],
]

export function noteMenu(paneId: string): MenuEntry[] {
  const commands = new Map(appCommands(views.of(paneId)).map((one) => [one.id, one]))
  const pick = (ids: readonly string[]) => ids.flatMap((id) => commands.get(id) ?? [])
  const formats = () => void import('./export/picker.svelte').then(({ picker }) => picker.show())

  return [
    ...pick(['history', 'print']),
    ...(__EVEN_PLUGIN__ ? [] : [{ label: 'Export', asks: true, run: formats }]),
    ...GROUPS.flatMap((ids) => [DIVIDER, ...pick(ids)]),
  ]
}
