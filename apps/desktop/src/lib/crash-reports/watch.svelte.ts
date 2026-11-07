import { listen } from '@tauri-apps/api/event'
import { log } from '../log'
import { invoke } from '../tauri'
import { updates } from '../updates.svelte'
import { workspace } from '../workspace.svelte'
import { crashReports } from './choice.svelte'
import { nativeSending, sendWaiting } from './send'

const ALIVE = 2000

const SHAPED = 2000

const AGAIN = 6 * 60 * 60 * 1000

const TOLD = 'nib://crash-report'

function kindsOf(tabs: readonly { kind: string }[]): Record<string, number> {
  const kinds: Record<string, number> = {}
  for (const tab of tabs) {
    if (/^[a-z][a-z-]{0,23}$/.test(tab.kind)) kinds[tab.kind] = (kinds[tab.kind] ?? 0) + 1
  }
  return kinds
}

export function watchForCrashes(sending: boolean): () => void {
  const alive = () => {
    void invoke('crash_alive', { visible: document.visibilityState === 'visible' }).catch(
      () => undefined,
    )
  }
  alive()
  const beating = setInterval(alive, ALIVE)
  document.addEventListener('visibilitychange', alive)

  let shaping: ReturnType<typeof setTimeout> | undefined
  const stopShape = $effect.root(() => {
    $effect(() => {
      const kinds = kindsOf(workspace.tabs)
      clearTimeout(shaping)
      shaping = setTimeout(() => {
        void invoke('crash_context', { kinds }).catch(() => undefined)
      }, SHAPED)
    })
  })

  if (!sending) {
    return () => {
      clearInterval(beating)
      clearTimeout(shaping)
      stopShape()
      document.removeEventListener('visibilitychange', alive)
    }
  }

  const how = nativeSending(
    () => crashReports.on,
    () => updates.channel,
  )
  let going = false
  const send = () => {
    if (going) return
    going = true
    void sendWaiting(how)
      .catch((error: unknown) => log('warn', `crash reports: ${String(error)}`))
      .finally(() => (going = false))
  }
  send()
  const again = setInterval(send, AGAIN)
  let unlisten: (() => void) | null = null
  void listen(TOLD, send).then((stop) => (unlisten = stop))

  return () => {
    clearInterval(beating)
    clearInterval(again)
    clearTimeout(shaping)
    stopShape()
    unlisten?.()
    document.removeEventListener('visibilitychange', alive)
  }
}
