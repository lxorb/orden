<script lang="ts">
  import { t } from '../i18n.svelte'
  import { pass } from './store.svelte'
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
      class="nib-field"
      type="password"
      autocomplete="current-password"
      placeholder={t('Current Pass password')}
      aria-label={t('Current Pass password')}
      aria-invalid={wrong}
      bind:value={old}
      oninput={() => (wrong = false)}
    />
  {/if}
  <input
    class="nib-field"
    type="password"
    autocomplete="new-password"
    placeholder={t('New Pass password')}
    aria-label={t('New Pass password')}
    bind:value={password}
  />
  <StrengthMeter {password} />
  <input
    class="nib-field"
    type="password"
    autocomplete="new-password"
    placeholder={t('Type it again')}
    aria-label={t('Type it again')}
    aria-invalid={differ}
    bind:value={again}
  />
  {#if short}
    <p class="wrong" role="alert">{t('At least {count} characters', { count: LEAST })}</p>
  {:else if differ}
    <p class="wrong" role="alert">{t('The two passwords differ')}</p>
  {:else if wrong}
    <p class="wrong" role="alert">{t('Wrong password')}</p>
  {/if}
  <div class="buttons">
    {#if oncancel}
      <button class="nib-button is-quiet" type="button" onclick={oncancel}>{t('Cancel')}</button>
    {/if}
    <button class="nib-button" type="submit" disabled={busy || !ready} aria-busy={busy}>
      {t('Change password')}
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
