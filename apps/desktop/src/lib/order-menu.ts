import { t } from './i18n.svelte'
import { DIVIDER, type MenuEntry } from './menu.svelte'
import { SORT_MODES, type SortMode } from './tree-order'
import { workspace } from './workspace.svelte'

const WORDS: Record<SortMode, () => string> = {
  name: () => t('Name, A to Z'),
  'name-desc': () => t('Name, Z to A'),
  'modified-desc': () => t('Modified, newest first'),
  'modified-asc': () => t('Modified, oldest first'),
  'created-desc': () => t('Created, newest first'),
  'created-asc': () => t('Created, oldest first'),
  manual: () => t('Manual'),
}

export function orderTitle(): string {
  return t('Order of the files')
}

export function orderMenu(): MenuEntry[] {
  const here = workspace.sortMode
  const row = (mode: SortMode) => ({
    label: WORDS[mode](),
    checked: here === mode,
    run: () => workspace.setSort(mode),
  })

  const [byName, backwards, ...rest] = SORT_MODES
  const arranged = rest.pop()

  return [
    ...(byName ? [row(byName)] : []),
    ...(backwards ? [row(backwards)] : []),
    DIVIDER,
    ...rest.map(row),
    DIVIDER,
    ...(arranged ? [row(arranged)] : []),
  ]
}
