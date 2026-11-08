import { untrack } from 'svelte'
import { accelerator } from '../accelerator'
import { i18n } from '../i18n.svelte'
import { heldForLife } from '../locks'
import { log } from '../log'
import { shortcuts } from '../shortcuts.svelte'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { quickAdd } from './asked.svelte'
import { addingOnce, ANSWERING, CHANNEL, heard, type Said } from './channel'
import { addTask, noteNames } from './write'

export function listen(): () => void {
  const stopping = new AbortController()
  let stopKey: (() => void) | null = null
  let channel: BroadcastChannel | null = null
  const added = addingOnce(async (entry, open) => {
    try {
      return (await addTask(entry, { open })) !== null
    } catch (error) {
      log('error', `quick add: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  })

  const answer = (said: Said) => {
    if (said.kind === 'hello') {
      const root = workspace.activeSpace?.root
      channel?.postMessage({
        kind: 'world',
        notes: root ? noteNames(root).slice(0, 400) : [],
        lang: i18n.language,
        smart: quickAdd.smart,
      } satisfies Said)
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
    channel?.close()
    if (stopKey) void invoke('quick_add_key', { key: null }).catch(() => undefined)
    quickAdd.held = false
  }
}
