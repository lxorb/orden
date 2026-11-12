<script lang="ts">
  import { onMount } from 'svelte'
  import { invoke } from '../tauri'
  import { asking, CHANNEL, heard, type Said } from './channel'
  import type { Entry } from './entry'
  import QuickAdd from './QuickAdd.svelte'

  let langs = $state<string[]>([navigator.language])
  let smart = $state(true)
  let shown = $state(0)

  const channel = new BroadcastChannel(CHANNEL)
  const say = (said: Said) => channel.postMessage(said)

  const asked = asking(say, 10_000)

  channel.onmessage = (event: MessageEvent) => {
    const said = heard(event.data)
    if (said?.kind === 'added') {
      asked.heard(said)
      return
    }
    if (said?.kind !== 'world') return
    langs = [said.lang]
    smart = said.smart
  }

  const hide = (raise = false) => void invoke('quick_add_hide', { raise }).catch(() => undefined)

  async function added(entry: Entry, open: boolean): Promise<boolean> {
    const ok = await asked.ask(entry, open)
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
