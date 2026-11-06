<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '../tauri'
  import { CHANNEL, heard, type Said } from './channel'
  import type { Entry } from './entry'
  import QuickAdd from './QuickAdd.svelte'

  let notes = $state<string[]>([])
  let langs = $state<string[]>([navigator.language])
  let smart = $state(true)
  let shown = $state(0)

  const channel = new BroadcastChannel(CHANNEL)
  const say = (said: Said) => channel.postMessage(said)

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  const waiting = new Map<number, (ok: boolean) => void>()
  let next = 0
  const ANSWER_WITHIN = 10_000

  channel.onmessage = (event: MessageEvent) => {
    const said = heard(event.data)
    if (said?.kind === 'added') {
      waiting.get(said.id)?.(said.ok)
      waiting.delete(said.id)
      return
    }
    if (said?.kind !== 'world') return
    notes = said.notes
    langs = [said.lang]
    smart = said.smart
  }

  const hide = (raise = false) => void invoke('quick_add_hide', { raise }).catch(() => undefined)

  async function added(entry: Entry, open: boolean): Promise<boolean> {
    const id = next++
    const ok = await new Promise<boolean>((resolve) => {
      const unanswered = setTimeout(() => {
        waiting.delete(id)
        resolve(false)
      }, ANSWER_WITHIN)
      waiting.set(id, (ok) => {
        clearTimeout(unanswered)
        resolve(ok)
      })
      say({ kind: 'task', id, entry, open })
    })
    if (ok) hide(open)
    return ok
  }

  onMount(() => {
    const again = () => {
      if (document.visibilityState !== 'visible') return
      shown++
      say({ kind: 'hello' })
    }
    again()
    document.addEventListener('visibilitychange', again)
    const left = () => hide()
    window.addEventListener('blur', left)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('blur', left)
      channel.close()
    }
  })
</script>

<main>
  {#key shown}
    <QuickAdd
      {langs}
      {notes}
      {smart}
      dictates={false}
      onsubmit={added}
      onclose={() => hide()}
      onpicking={(open) => void invoke('quick_add_tall', { tall: open }).catch(() => undefined)}
    />
  {/key}
</main>

<style>
  :global(html),
  :global(body) {
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--surface);
  }

  main {
    height: 100%;
  }
</style>
