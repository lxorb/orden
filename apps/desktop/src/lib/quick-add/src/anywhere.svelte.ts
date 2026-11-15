import { untrack } from 'svelte'
import { accelerator } from '../../ui-controls/src/api'
import { region, heldForLife, log, invoke } from '../../platform/src/api'
import { shortcuts } from '../../shortcuts/src/api'
import { theme } from '../../theme/src/api'
import { quickAdd } from './asked.svelte'
import { addingOnce, ANSWERING, CHANNEL, heard, type Said } from './channel'
import { addTask } from './write'

export function listen(): () => void {
  const stopping = new AbortController()
  let stopKey: (() => void) | null = null
  let channel: BroadcastChannel | null = null
  let stopDressing: (() => void) | null = null
  let telling = false
  const added = addingOnce(async (entry, open) => {
    try {
      return (await addTask(entry, { open })) !== null
    } catch (error) {
      log('error', `quick add: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  })

  const world = () =>
    channel?.postMessage({
      kind: 'world',
      lang: region(),
      smart: quickAdd.smart,
      dressed: theme.dressed(),
    } satisfies Said)

  const redressed = () => {
    if (telling) return
    telling = true
    queueMicrotask(() => {
      telling = false
      world()
    })
  }

  const answer = (said: Said) => {
    if (said.kind === 'hello') {
      world()
    } else if (said.kind === 'task') {
      void added(said.id, said.entry, said.open).then((ok) =>
        channel?.postMessage({ kind: 'added', id: said.id, ok } satisfies Said),
      )
    }
  }

  const answering = () => {
    channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      const said = heard(event.data)
      if (said) answer(said)
    }
    stopDressing = theme.redressed(redressed)
    stopKey = $effect.root(() => {
      $effect(() => {
        const key = quickAdd.anywhere
          ? accelerator(shortcuts.keyFor('app.quick-add'), shortcuts.platform)
          : null
        untrack(() => {
          void invoke<string | null>('quick_add_key', { key })
            .then((now) => (quickAdd.held = now !== null))
            .catch(() => (quickAdd.held = false))
        })
      })
    })
    return new Promise<void>((resolve) =>
      stopping.signal.addEventListener('abort', () => resolve()),
    )
  }

  heldForLife(ANSWERING, answering, stopping.signal)

  return () => {
    stopping.abort()
    stopKey?.()
    stopDressing?.()
    channel?.close()
    if (stopKey) void invoke('quick_add_key', { key: null }).catch(() => undefined)
    quickAdd.held = false
  }
}
