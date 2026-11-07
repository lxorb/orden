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
  await account.signOut('asked')
}
