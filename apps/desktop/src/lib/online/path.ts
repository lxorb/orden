/** Whether a file is an online terminal - a `.term`, whose words name a session on its
 *  owner's machine - and what its tab is called (docs/online-terminal.md 4.5, 4.10). */

import { isTermTarget } from '@orden/markdown/links'
import { termOf } from '@orden/online/term'

const TERM = /\.term$/i

/** Whether a tab is an online terminal: a terminal whose file is a `.term`, or one not
 *  saved yet, whose words are a `.term`'s and name its session (issue 1055: a new one is
 *  a tab like any other, in the sidebar only once the reader saves it). */
export function isOnlineTab(tab: { kind: string; path: string | null; doc?: string }): boolean {
  // The glasses' plugin has no terminal, and so no `.term` reader in its package.
  if (__EVEN_PLUGIN__ || tab.kind !== 'terminal') return false
  if (tab.path !== null) return isTermTarget(tab.path)
  return tab.doc !== undefined && termOf(tab.doc) !== null
}

/** The name a new online terminal's file is made with, numbered after the first. */
export const MADE_NAME = 'Terminal'

/** A `.term`'s name without its ending, as the tab says it. */
export function termName(name: string): string {
  return name.replace(TERM, '') || name
}

/** Whether a file's name is still the one it was made with, `Terminal` or `Terminal 2`, so
 *  the tab says what runs in it instead of the name. */
export function isMadeName(name: string): boolean {
  return new RegExp(`^${MADE_NAME}(?: \\d+)?$`, 'i').test(termName(name).trim())
}
