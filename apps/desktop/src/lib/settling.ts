/** The notes already on this machine, the moment an account's session begins.
 *
 *  Almost always nothing is asked. A device signing back in to the account it was
 *  last in step with resumes where it left off, note by note, the way Git
 *  fast-forwards; one whose notes would join the account without two different texts
 *  ever landing at one path just joins. The question is for the one case a person has
 *  to decide: notes of unknown standing - another account's, or ones no pass has
 *  seen - that would meet different words in the account's space of the same name.
 *  Then the answer is Merge, or Keep separate, and neither loses a word. See
 *  sync/returning.ts for the table and sync/meeting.ts for what meeting is.
 *
 *  Syncing waits for this, so the first pass already knows what was decided.
 *
 *  Its own file because two things begin a session: the emailed code, and a link that
 *  was its own proof. It is the same question either way, and asking it in two places
 *  is how two answers drift apart.
 *
 *  A guest is never asked, and never reaches this: there is no account for the
 *  writing here to join, because what a link lent them is a space beside their own
 *  notes. */

import { account } from './account.svelte'
import { t } from './i18n.svelte'
import { prompt } from './prompt.svelte'
import { meeting } from './sync/meeting'
import { apartName, asksOnReturn, baseFor } from './sync/returning'
import { MIRRORS_KEY, savedRecord } from './sync/saved'
import { stored } from './stored'
import { workspace } from './workspace.svelte'

export async function settleLocalNotes(): Promise<void> {
  try {
    const token = account.accountToken
    const user = account.user
    if (!token || !user) return

    // Back with the account this device was last in step with: the pass resumes.
    const base = baseFor(savedRecord(stored(MIRRORS_KEY)), user.id)
    if (base === 'mine') return

    const met = await meeting(token, workspace.spaces, account.spaces)
    if (!asksOnReturn(base, met.length > 0)) return

    const answer = await prompt.choose({
      title: t('This device already has notes.'),
      options: [
        { id: 'merge', label: t('Merge'), primary: true },
        { id: 'apart', label: t('Keep separate') },
      ],
    })
    if (answer === 'merge') return

    // Dismissing keeps them separate too: nothing is mixed into the account's spaces
    // that nobody agreed to, and nothing is lost either way.
    const taken = new Set([
      ...workspace.spaces.map((one) => one.name),
      ...account.spaces.map((one) => one.name),
    ])
    for (const space of met) {
      const id = workspace.spaces.find((one) => one.root === space.root)?.id
      if (id === undefined) continue
      const name = apartName(space.name, taken)
      taken.add(name)
      await workspace.renameSpace(id, name)
    }
  } finally {
    account.settled()
  }
}
