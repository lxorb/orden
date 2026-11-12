import { account } from '../../account.svelte'
import { prompt } from '../../prompt.svelte'
import { vault } from './start.svelte'

export async function signOut(): Promise<void> {
  const others = vault.allowed.some((one) => !one.mine)
  if (vault.standing === 'open' && others && vault.allowed.some((one) => one.mine)) {
    const answer = await prompt.choose({
      title: 'Also remove this device from your AI vault?',
      detail: 'The device can no longer read your AI accounts, and the others get a new key.',
      options: [
        { id: 'remove', label: 'Remove and sign out', danger: true },
        { id: 'keep', label: 'Sign out', primary: true },
      ],
    })
    if (answer === null) return
    if (answer === 'remove') await vault.leave()
  }
  await account.signOut('asked')
}
