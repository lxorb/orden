/** Signing out, with the question #389 asks of a device that holds the AI vault's key
 *  beside others: whether it goes from the vault as well, which changes the key for the
 *  devices that stay. A device alone in the vault, or not in it, signs out unasked; a
 *  question put away signs nobody out. Fetched with the press, like the sign-out it is. */

import { account } from '../../account.svelte'
import { t } from '../../i18n.svelte'
import { prompt } from '../../prompt.svelte'
import { vault } from './start.svelte'

export async function signOut(): Promise<void> {
  const others = vault.allowed.some((one) => !one.mine)
  if (vault.standing === 'open' && others && vault.allowed.some((one) => one.mine)) {
    const answer = await prompt.choose({
      title: t('Also remove this device from your AI vault?'),
      detail: t('The device can no longer read your AI accounts, and the others get a new key.'),
      options: [
        { id: 'remove', label: t('Remove and sign out'), danger: true },
        { id: 'keep', label: t('Sign out'), primary: true },
      ],
    })
    if (answer === null) return
    if (answer === 'remove') await vault.leave()
  }
  await account.signOut()
}
