/** What the settings file holds now (#673), which the rows of Settings read: where it
 *  is, the settings it holds, and what is wrong with it. Put there by file.ts, which is
 *  fetched at launch on a desktop and nowhere else; this is what the panes need of it. */

import { t } from '../i18n.svelte'
import { log } from '../log'
import { notify } from '../notify'
import type { Field } from './fields'

class Declared {
  /** Where the file is, once one was found. */
  path = $state<string | null>(null)
  /** The keys the file holds in force. */
  held = $state<ReadonlySet<string>>(new Set())
  /** What is wrong with the file, one line each, in the file's own terms. */
  problems = $state<string[]>([])

  /** Whether the file holds the setting by `key`: what every row asks, a field's and a
   *  row written by hand alike - a command's key, the search engine. */
  holds(key: string | undefined): boolean {
    return key !== undefined && this.path !== null && this.held.has(key)
  }

  /** What the row for `field` is now: as it was, or held by the file, its control
   *  doing nothing. */
  lock(field: Field): Field {
    if (!this.holds(field.key) || !this.path) return field
    const declared = this.path
    switch (field.kind) {
      case 'switch':
        return { ...field, declared, locked: () => true, set: () => undefined }
      case 'slider':
        return { ...field, declared, preview: () => undefined, set: () => undefined }
      case 'swatches': {
        // Nor the two colours of the reader's own after the swatches.
        const rest = { ...field }
        delete rest.pair
        return { ...rest, declared, set: () => undefined }
      }
      case 'select':
      case 'segmented':
      case 'text':
        return { ...field, declared, set: () => undefined }
      case 'picture':
      case 'value':
        return field
    }
  }

  /** What is wrong, said once as the app starts, as a notice that opens Settings - where
   *  the same lines stand at the top - since a setting that quietly did not apply is a
   *  configuration that seems to do nothing. The detail is the file's own terms, keys
   *  and JSON, so it stays as written rather than translated. */
  tell(open: () => void): void {
    if (!this.problems.length) return
    notify(t('The settings file has a problem'), this.problems.join('\n'), 'settings-file', open)
  }

  said(problems: string[]): void {
    this.problems = problems
    for (const one of problems) log('warn', `settings file: ${one}`)
  }
}

export const declared = new Declared()

/** The key a command's key is set by: its id with the dots as dashes, since a command
 *  may be named after another and more (`pages.fit`, `pages.fit.page`). */
export function shortcutKey(id: string): string {
  return `shortcuts.${id.replaceAll('.', '-')}`
}
