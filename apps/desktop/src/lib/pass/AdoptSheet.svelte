<script lang="ts">
  import { message } from '../message'
  import Sheet from '../Sheet.svelte'
  import { pass } from './store.svelte'
  import type { PassUi } from './ui.svelte'

  const { ui }: { ui: PassUi } = $props()

  const open = $derived(ui.sheet?.kind === 'adopt' && pass.conflict)

  let password = $state('')
  let busy = $state(false)
  let wrong = $state('')

  $effect(() => {
    if (!open) return
    password = ''
    wrong = ''
  })

  const close = () => (ui.sheet = null)

  async function adopted(event: SubmitEvent) {
    event.preventDefault()
    if (password === '' || busy) return
    busy = true
    wrong = ''
    try {
      if (await pass.adoptAccountPass(password)) close()
      else wrong = 'That is not the password of this account’s Pass.'
    } catch (error) {
      wrong = message(error, 'That Pass could not be opened.')
    } finally {
      busy = false
    }
  }
</script>

<Sheet {open} title="This account already has a Pass" onclose={close}>
  <form class="adopt" onsubmit={adopted}>
    <p class="quiet">
      Another device made a Pass for this account first. Enter that Pass’s password to use it here;
      what is on this device moves into a vault of its own.
    </p>
    <input
      class="orden-field is-value"
      type="password"
      autocomplete="current-password"
      placeholder="Pass password"
      aria-label="Pass password"
      bind:value={password}
      data-lands
    />
    {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
    <div class="buttons">
      <button class="orden-button is-quiet" type="button" onclick={close}>Later</button>
      <button class="orden-button" type="submit" disabled={busy || password === ''}
        >Use that Pass</button
      >
    </div>
  </form>
</Sheet>

<style>
  .adopt {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-2) var(--space-2);
  }

  .quiet {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
