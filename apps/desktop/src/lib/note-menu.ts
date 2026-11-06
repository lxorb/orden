import { appCommands, exportCommands } from './commands'
import { t } from './i18n.svelte'
import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
import { views } from './views.svelte'

const GROUPS: readonly (readonly string[])[] = [
  ['read-only', 'reading', 'present'],
  ['source', 'focus', 'typewriter'],
  ['view.fold', 'view.fold-all', 'view.fold-more', 'view.fold-less', 'view.unfold-all'],
]

export function noteMenu(event: MouseEvent, paneId: string): MenuEntry[] {
  const commands = new Map(appCommands(views.of(paneId)).map((one) => [one.id, one]))
  const pick = (ids: readonly string[]) => ids.flatMap((id) => commands.get(id) ?? [])
  const formats = () => menu.show(event, exportCommands(), { title: t('Export') })

  return [
    ...pick(['history', 'print']),
    ...(__EVEN_PLUGIN__ ? [] : [{ label: t('Export'), asks: true, run: formats }]),
    ...GROUPS.flatMap((ids) => [DIVIDER, ...pick(ids)]),
  ]
}
