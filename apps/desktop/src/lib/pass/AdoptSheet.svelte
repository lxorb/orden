<script lang="ts">
  import { message, t } from '../i18n.svelte'
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
      else wrong = t('That is not the password of this account’s Pass.')
    } catch (error) {
      wrong = message(error, 'That Pass could not be opened.')
    } finally {
      busy = false
    }
  }
</script>

<Sheet {open} title={t('This account already has a Pass')} onclose={close}>
  <form class="adopt" onsubmit={adopted}>
    <p class="quiet">
      {t(
        'Another device made a Pass for this account first. Enter that Pass’s password to use it here; what is on this device moves into a vault of its own.',
      )}
    </p>
    <input
      class="nib-field is-value"
      type="password"
      autocomplete="current-password"
      placeholder={t('Pass password')}
      aria-label={t('Pass password')}
      bind:value={password}
      data-lands
    />
    {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
    <div class="buttons">
      <button class="nib-button is-quiet" type="button" onclick={close}>{t('Later')}</button>
      <button class="nib-button" type="submit" disabled={busy || password === ''}
        >{t('Use that Pass')}</button
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
