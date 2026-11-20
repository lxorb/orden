import { whenLoaded } from '@orden/contracts'
import { account } from './accounts/src/api'
import { recovery } from './history/src/api'
import { modes } from './modes/src/api'
import { shortcuts, toolbar } from './shortcuts/src/api'
import { spaceArchiving } from './spaces/src/api'

interface Hears {
  on(type: 'settings', run: () => void): () => void
  opened(run: () => void): () => void
}
export function settingsFollower<T>(
  token: () => string | null,
  adopt: (token: string) => Promise<T | null>,
  fan: (remote: T) => void,
) {
  let running = false
  let wanted = 0
  async function take(): Promise<void> {
    wanted++
    if (running) return
    running = true
    try {
      let seen: number
      do {
        seen = wanted
        const now = token()
        if (!now) return
        const remote = await adopt(now)
        if (remote) fan(remote)
      } while (wanted !== seen)
    } finally {
      running = false
    }
  }
  const asked = () => void take().catch(() => undefined)
  return {
    take: asked,
    hear(hub: Hears): () => void {
      const offs = [hub.on('settings', asked), hub.opened(asked)]
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
export const accountSettings = settingsFollower(
  () => account.accountToken,
  (token) => modes.adopt(token),
  (remote) => {
    shortcuts.receive(remote)
    toolbar.receive(remote)
    whenLoaded(
      () => import('./gates/src/api'),
      (gates) => gates.receive(remote),
    )
    recovery.receive(remote)
    whenLoaded(spaceArchiving, (archiving) => void archiving.receive(remote))
    if (!__EVEN_PLUGIN__)
      whenLoaded(
        () => import('./chats-client/src/api'),
        ({ hush }) => hush.receive(remote),
      )
  },
)
export function hearAccountSettings(): () => void {
  let stop: (() => void) | null = null
  const off = whenLoaded(
    () => import('./sync-client/src/api'),
    ({ hub }) => (stop = accountSettings.hear(hub)),
  )
  return () => {
    off()
    stop?.()
  }
}
