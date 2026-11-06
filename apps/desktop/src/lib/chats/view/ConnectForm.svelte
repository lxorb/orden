<script lang="ts">
  /** Connecting an account of another chat service (#321): the questions its provider
   *  asks. Secrets go to the vault; the rest stays on this device. */
  import type { ChatProvider } from '@orden/chats/provider'
  import { t } from '../../i18n.svelte'
  import { accounts } from '../linked'

  const { provider, done }: { provider: ChatProvider; done: () => void } = $props()

  const labels: Record<string, string> = {
    address: t('Email address'),
    password: t('Password'),
    name: t('Your name'),
    imapHost: t('IMAP server'),
    smtpHost: t('SMTP server'),
    user: t('User name'),
  }

  const values = $state<Record<string, string>>({})
  let busy = $state(false)
  let problem = $state<string | null>(null)

  const ready = $derived(
    provider.fields.every(
      (field) => field.optional === true || (values[field.key] ?? '').trim() !== '',
    ),
  )

  async function connect(event: SubmitEvent) {
    event.preventDefault()
    if (!ready || busy) return
    busy = true
    problem = await accounts.connect(provider.id, { ...values })
    busy = false
    if (problem === null) done()
  }
</script>

<form class="connect" onsubmit={connect}>
  {#each provider.fields as field (field.key)}
    <label class="field">
      <span>{labels[field.key] ?? field.label}</span>
      <input
        class="nib-field"
        type={field.kind === 'password' ? 'password' : field.kind === 'email' ? 'email' : 'text'}
        autocomplete={field.kind === 'password' ? 'current-password' : 'off'}
        spellcheck="false"
        bind:value={values[field.key]}
      />
    </label>
  {/each}
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  <div class="actions">
    <button class="nib-button is-quiet" type="button" onclick={done}>{t('Cancel')}</button>
    <button class="nib-button" type="submit" disabled={!ready || busy}
      >{busy ? t('Connecting…') : t('Connect')}</button
    >
  </div>
</form>

<style>
  .connect {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .problem {
    margin: 0;
    color: var(--danger, var(--muted));
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
