<script lang="ts">
  import Lock from 'lucide/dist/esm/icons/lock.mjs'
  import Icon from '../Icon.svelte'
  import { t } from '../i18n.svelte'
  import { nameOf } from '../space-paths'
  import { unlockAt } from './unlocking'

  const { path, focused = false }: { path: string; focused?: boolean } = $props()

  let typed = $state('')
  let wrong = $state(false)
  let busy = $state(false)
  let field = $state<HTMLInputElement>()

  $effect(() => {
    if (focused) field?.focus({ preventScroll: true })
  })

  async function unlock(event: SubmitEvent) {
    event.preventDefault()
    if (busy || !typed) return
    busy = true
    const opened = await unlockAt(path, typed)
    busy = false
    wrong = !opened
    if (!opened) {
      typed = ''
      field?.focus()
    }
  }
</script>

<div class="locked" data-region="editor" role="group" aria-label={t('Protected')}>
  <span class="mark" aria-hidden="true"><Icon icon={null} fallback={Lock} /></span>
  <p class="name">{nameOf(path)}</p>
  <form class="unlock" onsubmit={unlock}>
    <input
      bind:this={field}
      bind:value={typed}
      class="nib-field"
      type="password"
      autocomplete="current-password"
      placeholder={t('Password')}
      aria-label={t('Password')}
      aria-invalid={wrong}
      oninput={() => (wrong = false)}
    />
    <button class="nib-button" type="submit" disabled={busy || !typed}>{t('Unlock')}</button>
  </form>
  {#if wrong}
    <p class="wrong" role="alert">{t('Wrong password')}</p>
  {/if}
  <p class="note">
    {t('Protected, not encrypted: this only keeps it from being opened by accident.')}
  </p>
</div>

<style>
  .locked {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    padding: var(--space-6);
    font-family: var(--font-ui);
    color: var(--muted);
    text-align: center;
  }

  .mark {
    width: var(--icon-lg);
    height: var(--icon-lg);
    font-size: var(--icon-lg);
    color: var(--muted-strong);
  }

  .name {
    margin: 0;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .unlock {
    display: flex;
    gap: var(--space-2);
    width: min(100%, 320px);
  }

  .unlock .nib-field {
    flex: 1;
    min-width: 0;
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .note {
    margin: 0;
    max-width: 320px;
    font-size: var(--text-sm);
  }
</style>
