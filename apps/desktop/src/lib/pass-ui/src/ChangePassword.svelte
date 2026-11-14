<script lang="ts">
  import { pass } from '../../pass-sync/src/api'
  import StrengthMeter from './StrengthMeter.svelte'

  const { ondone, oncancel }: { ondone: () => void; oncancel?: () => void } = $props()

  const LEAST = 8

  let old = $state('')
  let password = $state('')
  let again = $state('')
  let busy = $state(false)
  let wrong = $state(false)

  const asksOld = $derived(!pass.mustChangePassword)
  const short = $derived(password.length > 0 && password.length < LEAST)
  const differ = $derived(again.length > 0 && again !== password)
  const ready = $derived((!asksOld || old !== '') && password.length >= LEAST && again === password)

  async function changed(event: SubmitEvent) {
    event.preventDefault()
    if (busy || !ready) return
    busy = true
    const ok = await pass.changePassword(old, password)
    busy = false
    wrong = !ok
    if (ok) ondone()
  }
</script>

<form class="change" onsubmit={changed}>
  {#if asksOld}
    <input
      class="orden-field"
      type="password"
      autocomplete="current-password"
      placeholder="Current Pass password"
      aria-label="Current Pass password"
      aria-invalid={wrong}
      bind:value={old}
      oninput={() => (wrong = false)}
    />
  {/if}
  <input
    class="orden-field"
    type="password"
    autocomplete="new-password"
    placeholder="New Pass password"
    aria-label="New Pass password"
    bind:value={password}
  />
  <StrengthMeter {password} />
  <input
    class="orden-field"
    type="password"
    autocomplete="new-password"
    placeholder="Type it again"
    aria-label="Type it again"
    aria-invalid={differ}
    bind:value={again}
  />
  {#if short}
    <p class="wrong" role="alert">At least {LEAST} characters</p>
  {:else if differ}
    <p class="wrong" role="alert">The two passwords differ</p>
  {:else if wrong}
    <p class="wrong" role="alert">Wrong password</p>
  {/if}
  <div class="buttons">
    {#if oncancel}
      <button class="orden-button is-quiet" type="button" onclick={oncancel}>Cancel</button>
    {/if}
    <button class="orden-button" type="submit" disabled={busy || !ready} aria-busy={busy}>
      Change password
    </button>
  </div>
</form>

<style>
  .change {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
