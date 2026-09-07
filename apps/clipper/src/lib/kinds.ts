/** The three clips, and the one word each of them is called by.
 *
 *  The order is the order they are offered in: the popup's row of buttons, the
 *  page's own menu, and the shortcuts in the manifest all read from here, so
 *  Page is always first and Link always last. */

export type Kind = 'page' | 'selection' | 'link'

export const KINDS = ['page', 'selection', 'link'] as const satisfies readonly Kind[]

/** English, and so also the key each dictionary translates. */
export const LABELS: Record<Kind, string> = {
  page: 'Page',
  selection: 'Selection',
  link: 'Link',
}
