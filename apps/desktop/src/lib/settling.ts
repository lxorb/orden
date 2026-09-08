/** The notes already on this machine, the moment an account's session begins.
 *
 *  Signing in on a machine that already holds notes needs an answer: they either
 *  join the account or they go. Nothing is deleted without one, and syncing waits
 *  for it, because a first pass would otherwise send up the very notes about to
 *  be erased and adopt the account's spaces into the erasing.
 *
 *  Its own file because two things begin a session now: the emailed code, and a
 *  link that was its own proof. It is the same question either way, and asking it
 *  in two places is how two answers drift apart.
 *
 *  A guest is never asked, and never reaches this: there is no account for the
 *  writing here to join and nothing to erase, because what a link lent them is a
 *  space beside their own notes. */

import { account } from './account.svelte'
import { t } from './i18n.svelte'
import { prompt } from './prompt.svelte'
import { workspace } from './workspace.svelte'

export async function settleLocalNotes(): Promise<void> {
  try {
    if (!(await workspace.hasLocalContent())) return

    const answer = await prompt.choose({
      title: t('You already have notes on this computer.'),
      detail: t(
        'Keep them and they join your account. Erase them and only what your account already holds remains - this cannot be undone.',
      ),
      options: [
        { id: 'keep', label: t('Keep them'), primary: true },
        { id: 'erase', label: t('Erase them'), danger: true },
      ],
    })

    // Dismissing the question keeps them, which is the answer that loses nothing.
    if (answer === 'erase') await workspace.eraseLocalSpaces()
  } finally {
    account.settled()
  }
}
