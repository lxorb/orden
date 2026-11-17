import type { TabKindParts } from '@orden/contracts'
import { makeApplication } from './make'
import { openApplication } from './open'
import { appSessionIfAny } from './session.svelte'

export const applicationTabKind: TabKindParts = {
  open: (path, how) => {
    openApplication(path, how)
    return Promise.resolve()
  },
  make: async () => {
    await makeApplication()
  },
  hold: (id) => appSessionIfAny({ id })?.picture.hold() ?? null,
  facts: (id) => {
    const session = appSessionIfAny({ id })
    if (!session) return Promise.resolve(null)
    const { stats, usage, encoder } = session.picture
    return Promise.resolve({
      host: session.hostName || null,
      usage,
      stream: stats ? { ...stats, encoder: encoder?.name ?? null } : null,
    })
  },
}
