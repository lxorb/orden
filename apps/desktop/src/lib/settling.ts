/** The notes already on this machine, the moment an account's session begins.
 *
 *  Almost always nothing is asked: a device back with the account it was last in step
 *  with resumes note by note, and notes that would land nowhere another text is just
 *  join. Only notes of unknown standing that would meet other words in the account's
 *  space of that name ask, Merge or Keep separate, and neither loses a word. The table
 *  is sync/returning.ts's; syncing waits for this.
 *
 *  Its own file because a code and a link both begin a session, and one question
 *  asked in two places drifts apart. A guest is never asked: there is no account for
 *  the writing here to join. */

import { account } from './account.svelte'
import { t } from './i18n.svelte'
import { prompt } from './prompt.svelte'
import { MIRRORS_KEY, savedRecord } from './sync/mirror'
import { stored } from './stored'
import { workspace } from './workspace.svelte'

export async function settleLocalNotes(): Promise<void> {
  try {
    const token = account.accountToken
    const user = account.user
    if (!token || !user) return

    // Fetched with the sign-in rather than the launch, like everything after it.
    const { apartName, asksOnReturn, baseFor } = await import('./sync/returning')

    // Back with the account this device was last in step with: the pass resumes.
    const base = baseFor(savedRecord(stored(MIRRORS_KEY)), user.id)
    if (base === 'mine') return

    // Fetched only here, the one sign-in in many that has something to compare.
    const { meeting } = await import('./sync/meeting')
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
