import { account } from './accounts/src/api'
import { prompt } from './prompt.svelte'
import { MIRRORS_KEY, savedRecord } from './sync/mirror'
import { rootedAt } from './space-paths'
import { stored } from './stored'
import { workspace } from './workspace.svelte'

export async function settleLocalNotes(): Promise<void> {
  try {
    const token = account.accountToken
    const user = account.user
    if (!token || !user) return

    const { apartName, asksOnReturn, baseFor } = await import('./sync/returning')

    const base = baseFor(savedRecord(stored(MIRRORS_KEY)), user.id)
    if (base === 'mine') return

    const { meeting } = await import('./sync/meeting')
    const met = await meeting(token, workspace.spaces, account.spaces)
    if (!asksOnReturn(base, met.length > 0)) return

    const answer = await prompt.choose({
      title: 'This device already has notes.',
      options: [
        { id: 'merge', label: 'Merge', primary: true },
        { id: 'apart', label: 'Keep separate' },
      ],
    })
    if (answer === 'merge') return

    const taken = new Set([
      ...workspace.spaces.map((one) => one.name),
      ...account.spaces.map((one) => one.name),
    ])
    for (const space of met) {
      const id = rootedAt(workspace.spaces, space.root)?.id
      if (id === undefined) continue
      const name = apartName(space.name, taken)
      taken.add(name)
      await workspace.renameSpace(id, name)
    }
  } finally {
    account.settled()
  }
}
