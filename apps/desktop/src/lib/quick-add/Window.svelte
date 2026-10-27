<script lang="ts">
  /** The global quick add window: the field and nothing else, over whatever app is in
   *  front (docs/tasks.md 5.6). The crate shows it on the key and hides it again on
   *  Escape, on a task added and as soon as it is left; see src-tauri/src/quick_add.rs.
   *
   *  It writes nothing itself. What the line needs to be read - the space's notes, the
   *  app's language - it asks the app for as it opens, and the task it hands back over
   *  the same channel, so it is written where the workspace is (anywhere.svelte.ts). */
  import { onMount } from 'svelte'
  import { invoke } from '../tauri'
  import { CHANNEL, heard, type Said } from './channel'
  import type { Entry } from './entry'
  import QuickAdd from './QuickAdd.svelte'

  let notes = $state<string[]>([])
  let langs = $state<string[]>([navigator.language])
  let smart = $state(true)
  /** Which showing this is, so the field starts empty each time the key is pressed. */
  let shown = $state(0)

  const channel = new BroadcastChannel(CHANNEL)
  const say = (said: Said) => channel.postMessage(said)

  /** The tasks handed to the app and not yet answered, by the number each went with. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- nothing renders from it
  const waiting = new Map<number, (ok: boolean) => void>()
  let next = 0
  /** How long the app may take to write a task, in milliseconds: long enough for an
   *  inbox made the first time and a note open in a pane taking the line. */
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

  /** Put away once the app says the task is in, and not before: one it could put
   *  nowhere - every space shared to be read - stays in the field, and so does one no
   *  window of the app was there to take. */
  async function added(entry: Entry, open: boolean): Promise<boolean> {
    const id = next++
    const ok = await new Promise<boolean>((resolve) => {
      // No window of the app answering is a task not taken: the field keeps it, and
      // Enter tries again, rather than the window waiting on nobody for ever.
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
    // Asked again each time it comes back, since the space in front may have changed.
    const again = () => {
      if (document.visibilityState !== 'visible') return
      shown++
      say({ kind: 'hello' })
    }
    again()
    document.addEventListener('visibilitychange', again)
    // Left for another app: put away, the way every launcher's field is.
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
