import { account } from '../../accounts/src/api'
import { busy } from '../../busy.svelte'
import { message } from '../../message'
import { prompt } from '../../prompt.svelte'
import { sync } from '../../sync.svelte'
import type { Space } from '../../workspace.svelte'
import { nameIn } from '../../accounts/src/api'

export async function nameHere(space: Space): Promise<void> {
  const id = sync.remoteIdFor(space.root)
  if (!id || !account.user) return

  const given = await prompt.ask({
    title: `Your name in ${space.name}`,
    value: account.user.nicks?.[id] ?? '',
    placeholder: account.name ?? '',
    confirmLabel: 'Save',
  })
  if (given === null) return

  try {
    await nameIn(id, given.trim())
  } catch (error) {
    busy.failed(message(error, 'that did not work'))
  }
}
