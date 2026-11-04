/** Which tabs a close around one tab takes: the rows of a tab's own menu that close
 *  more than the tab. */

import { i18n, t } from '../i18n.svelte'

export type Around = 'others' | 'right' | 'all'

export function closedAround<T extends { readonly id: string }>(
  strip: readonly T[],
  id: string,
  which: Around,
): T[] {
  const at = strip.findIndex((one) => one.id === id)
  if (at < 0) return []

  return which === 'all'
    ? [...strip]
    : which === 'right'
      ? strip.slice(at + 1)
      : strip.filter((one) => one.id !== id)
}

/** Left and right in a label are the screen's, so a language that reads the other
 *  way closes the tabs to the left. */
export function closeAfterLabel(): string {
  return i18n.factor > 0 ? t('Close tabs to the right') : t('Close tabs to the left')
}
