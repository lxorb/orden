/** Making an online terminal: a new tab's card on O (Ctrl+T or the plus), the palette's New
 *  online terminal and an empty pane all come here (docs/online-terminal.md 4.5, 4.10).
 *
 *  A new session on the reader's own machine - made, and started, if there is none yet -
 *  in a tab of its own that is not saved, as every new tab is (issue 1055): no file and no
 *  row in the list, its words a `.term`'s naming the session, which is keyed by its own id
 *  on the account and reached by its owner's devices alone. Saving it - Ctrl+S, or the tab
 *  dropped on the list - writes the `.term` (`keepTerm` in workspace/placing.ts), and the
 *  file carries it from then on: renamed, moved, bookmarked and opened on another device,
 *  as a note is, the account giving the session the file's id (`adopt` in routes.ts).
 *  Signed out it opens the account sheet; not on the list yet, it says so. */

import { account } from '../account.svelte'
import { t } from '../i18n.svelte'
import type { OpenHow } from '../new-tab'
import { termText } from '@orden/online/term'
import { nameOf, samePath } from '../space-paths'
import type { Tab } from '../workspace/documents.svelte'
import { workspace } from '../workspace.svelte'
import { type Refused, refusedOf, termSession } from './calls'
import { machine } from './machine.svelte'
import { refusalWords } from './words'
import { MADE_NAME, termName } from './path'

/** A new online terminal, in the pane that has the keyboard: beside the tab in front with
 *  `beside` (Open another, a split), at the end of the strip otherwise. Null where none
 *  was made. */
export async function openOnline(beside = false): Promise<Tab | null> {
  if (!account.accountToken) {
    account.ask()
    return null
  }
  // Not on the list yet, or the service off: said before any session is made. Asked again
  // every time, but waited for only when this window has not heard yes already: the
  // socket says a refusal that came since, and the terminal is on its way meanwhile.
  const asking = machine.refresh()
  if (machine.known?.allowed !== true || machine.refused !== null) await asking
  const why = machine.known?.allowed === false ? 'list' : machine.refused
  if (why) {
    await refused(why)
    return null
  }

  // The session first, keyed by its own id: the tab's words name it, and nothing is
  // written into the space until the reader saves it.
  let words: string
  try {
    words = termText(await termSession(null))
  } catch (error) {
    await refused(refusedOf(error))
    return null
  }
  if (__EVEN_PLUGIN__) return null
  const tab = workspace.openUnsaved(
    'terminal',
    words,
    MADE_NAME,
    beside ? workspace.activeTabId : null,
  )
  workspace.persist()
  return tab
}

/** A `.term` in a tab of its own: a terminal tab whose document is the file, one tab per
 *  file as a PDF has, so opening it again brings the one there is forward. Its words are
 *  the file's where the caller has them, and the terminal reads the file otherwise; a
 *  restart puts it back as any tab with a file comes back. Null in the glasses' plugin,
 *  which has no terminal. */
export function openTerm(path: string, how: OpenHow = {}, text = ''): Tab | null {
  if (__EVEN_PLUGIN__) return null
  const open = workspace.tabs.find((one) => one.kind === 'terminal' && samePath(one.path, path))
  if (open) {
    if (how.activate !== false) workspace.activeTabId = open.id
    return open
  }

  const beside = how.beside ? workspace.activeTabId : null
  const name = termName(nameOf(path))
  const tab = workspace.openUnsaved('terminal', text, name, beside, how.activate ?? true)
  tab.path = path
  workspace.persist()
  return tab
}

/** Why no terminal was made, said once in the question sheet. */
async function refused(why: Refused): Promise<void> {
  if (why === 'signed-out') {
    account.ask()
    return
  }
  const title = refusalWords(why)
  if (title === null) return
  const { prompt } = await import('../prompt.svelte')
  await prompt.choose({ title, options: [{ id: 'ok', label: t('OK'), primary: true }] })
}
