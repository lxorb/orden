/** The dots at the end of a note's strip (#304): the rows of the app menu that are about
 *  the note in that pane rather than the app. Each is the palette's own command, picked
 *  by its id, so the dots, the palette and the keys run the same code. */

import { appCommands, exportCommands } from './commands'
import { t } from './i18n.svelte'
import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
import { views } from './views.svelte'

/** After history, print and Export: how the note is read, how it is written, its folds. */
const GROUPS: readonly (readonly string[])[] = [
  ['read-only', 'reading', 'present'],
  ['source', 'focus', 'typewriter'],
  ['view.fold', 'view.fold-all', 'view.fold-more', 'view.fold-less', 'view.unfold-all'],
]

/** The rows for the note in `paneId`, which the press on the dots has already made the
 *  focused pane (Pane.svelte). Export's formats open in the menu's place. */
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
