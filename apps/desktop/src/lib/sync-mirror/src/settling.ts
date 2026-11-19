import { workspaceView } from '@orden/contracts'
import { account } from '../../accounts/src/api'
import { prompt } from '../../ui-kit/src/api'
import { rootedAt, stored } from '../../platform/src/api'
import { MIRRORS_KEY, savedRecord } from './mirror'

export async function settleLocalNotes(): Promise<void> {
  try {
    const token = account.accountToken
    const user = account.user
    if (!token || !user) return

    const { apartName, asksOnReturn, baseFor } = await import('./returning')

    const base = baseFor(savedRecord(stored(MIRRORS_KEY)), user.id)
    if (base === 'mine') return

    const { meeting } = await import('./meeting')
    const met = await meeting(token, workspaceView().spaces, account.spaces)
    if (!asksOnReturn(base, met.length > 0)) return

    const answer = await prompt.choose({
      title: 'This device already has notes.',
      options: [
        { id: 'merge', label: 'Merge', primary: true },
        { id: 'apart', label: 'Keep separate' },
      ],
    })
    if (answer === 'merge') return

    const taken = new Set([...workspaceView().spaces.map((one) => one.name), ...account.spaces.map((one) => one.name)])
    for (const space of met) {
      const id = rootedAt(workspaceView().spaces, space.root)?.id
      if (id === undefined) continue
      const name = apartName(space.name, taken)
      taken.add(name)
      await workspaceView().renameSpace(id, name)
    }
  } finally {
    account.settled()
  }
}
