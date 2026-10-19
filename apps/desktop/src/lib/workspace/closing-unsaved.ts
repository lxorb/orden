/** The question before a tab with unsaved words closes.
 *
 *  Emil, 2026-10-15 (#359): *"when closing something that's unsaved (e.g. a note) then
 *  you should get a warning modal"*. It used to go without a word, its words kept on the
 *  closed stack and in Recently deleted; now it asks first, as VS Code and Notepad ask
 *  "Save changes?":
 *
 *  - **Save** gives it a file and then closes it. One tab is asked where, in the layer
 *    Ctrl+S puts under it, and closes once it is saved there; let go of that layer and
 *    the tab stays. Several are each saved where Save would offer first - the root of
 *    the space they were opened in, under their first line - and then close.
 *  - **Don't save** closes it as before: its words on the closed stack for Ctrl+Shift+T
 *    and in Recently deleted, so a slip is still undone.
 *  - **Cancel**, Escape or a press outside keeps every tab.
 *
 *  What counts is a draft with words in it (`isDraft` and `hasWords`): a note with a file
 *  writes itself and has nothing unsaved, an empty new tab has nothing to lose, and a web
 *  tab nobody kept has nothing unwritten in it. A draft still open in a tab that is not
 *  closing is not lost either, so it is not asked about. One question for every tab a
 *  gesture closes, as the terminals' is.
 *
 *  Only a close somebody asked for asks (`closeAsking`, `closeMany`, `closePane`): a tab
 *  closed because its note went away, and the window closing - which brings every tab
 *  with no file back with its words next time (`workspace/session.ts`) - do not. Here
 *  rather than in the store because none of it is needed until such a tab closes. */

import { key, t } from '../i18n.svelte'
import type { Tab } from '../workspace.svelte'
import { hasWords, isDraft } from './drafts'

/** The tabs among `closing` whose words would leave with them: drafts with words, held
 *  by no tab that stays. */
export function unsavedAmong(closing: readonly Tab[], every: readonly Tab[]): Tab[] {
  const going = new Set(closing.map((one) => one.id))
  const seen = new Set<Tab['note']>()
  return closing.filter((tab) => {
    if (!isDraft(tab.note) || !hasWords(tab.note) || seen.has(tab.note)) return false
    seen.add(tab.note)
    return !every.some((other) => !going.has(other.id) && other.note === tab.note)
  })
}

/** What to do with those tabs, as `askUnsaved` answers it. */
type Unsaved = 'save' | 'discard' | 'keep'

/** What closing needs of the workspace. */
interface Closing {
  tabs: Tab[]
  save(tab: Tab): Promise<string | null>
  closeAsking(id: string): Promise<void>
}

/** Whether the unsaved words among `closing` may go, asked once: Don't save lets them
 *  go to Recently deleted; Save gives each a file first, and for one tab that is the
 *  layer Ctrl+S puts under it, which closes it once it is saved and leaves it open if
 *  let go of. */
export async function mayLose(ws: Closing, closing: readonly Tab[]): Promise<boolean> {
  const unsaved = unsavedAmong(closing, ws.tabs)
  const answer = await askUnsaved(unsaved)
  if (answer !== 'save') return answer === 'discard'

  const [only] = unsaved
  if (only && unsaved.length === 1) {
    const { askPlace } = await import('../save-place/door')
    askPlace(only.id, () => void ws.closeAsking(only.id))
    return false
  }
  const saved = await Promise.all(unsaved.map((tab) => ws.save(tab)))
  return saved.every((path) => path !== null)
}

/** One question for every tab among `unsaved`. */
async function askUnsaved(unsaved: readonly Tab[]): Promise<Unsaved> {
  const [only] = unsaved
  if (!only) return 'discard'

  const { prompt } = await import('../prompt.svelte')
  const answer = await prompt.choose({
    title:
      unsaved.length === 1
        ? t('Save changes to {name}?', { name: only.shown })
        : t('Save changes to these tabs?'),
    detail: t('Unsaved words go to Recently deleted.'),
    options: [
      { id: 'keep', label: key('Cancel') },
      { id: 'discard', label: key('Don’t save') },
      { id: 'save', label: key('Save'), primary: true },
    ],
  })
  return answer === 'save' || answer === 'discard' ? answer : 'keep'
}
