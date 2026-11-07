<script lang="ts">
  import type { ChatProvider, ConnectField } from '@orden/chats/provider'
  import { t } from '../../i18n.svelte'
  import { accounts } from '../linked'
  import { screens } from '../providers/screens.svelte'
  import SignIn from './SignIn.svelte'

  const { providers, done }: { providers: readonly ChatProvider[]; done: () => void } = $props()

  const labels: Record<string, string> = {
    address: t('Email address'),
    password: t('Password'),
    name: t('Your name'),
    imapHost: t('IMAP server'),
    smtpHost: t('SMTP server'),
    user: t('User name'),
    phone: t('Phone number'),
  }

  let chosen = $state(0)
  const provider = $derived(providers.at(chosen) ?? providers.at(0))
  const values = $state<Record<string, string>>({})
  let understood = $state(false)
  let busy = $state(false)
  let attempt = 0
  let problem = $state<string | null>(null)

  const ready = $derived(
    !!provider &&
      (!provider.warning || understood) &&
      provider.fields.every((field) => field.optional === true || valueOf(field).trim() !== ''),
  )

  function typeOf(field: ConnectField): string {
    switch (field.kind) {
      case 'password':
        return 'password'
      case 'email':
        return 'email'
      case 'phone':
        return 'tel'
      case 'url':
        return 'url'
      case 'number':
        return 'number'
      case 'text':
      case 'select':
        return 'text'
    }
  }

  function pick(index: number) {
    chosen = index
    understood = false
    problem = null
  }

  function valueOf(field: ConnectField): string {
    return (
      values[`${provider?.id ?? ''}:${field.key}`] ??
      field.initial ??
      field.options?.[0]?.value ??
      ''
    )
  }

  async function connect(event: SubmitEvent) {
    event.preventDefault()
    if (!ready || busy || !provider) return
    busy = true
    const mine = ++attempt
    problem = null
    const asked: Record<string, string> = {}
    for (const field of provider.fields) {
      const value = valueOf(field)
      if (value !== '') asked[field.key] = value
    }
    const reason = await accounts.connect(provider.id, asked)
    screens.show(null)
    busy = false
    if (mine !== attempt) return
    problem = reason === null ? null : t(reason)
    if (reason === null) done()
  }

  function stop() {
    if (!busy) {
      done()
      return
    }
    attempt += 1
    screens.cancelAll()
  }
</script>

<form class="connect" onsubmit={connect}>
  {#if providers.length > 1}
    <div class="services" role="radiogroup" aria-label={t('Service')}>
      {#each providers as one, index (one.id)}
        <button
          type="button"
          role="radio"
          class="orden-chip service"
          class:is-on={index === chosen}
          aria-checked={index === chosen}
          disabled={busy}
          onclick={() => pick(index)}
          ><svg viewBox="0 0 24 24" aria-hidden="true" class="mark"><path d={one.icon} /></svg
          >{one.name}</button
        >
      {/each}
    </div>
  {/if}
  {#if provider}
    {#each provider.fields as field (`${provider.id}:${field.key}`)}
      <label class="field">
        <span>{labels[field.key] ?? t(field.label)}</span>
        {#if field.kind === 'select'}
          <select
            class="orden-field"
            value={valueOf(field)}
            disabled={busy}
            onchange={(event) =>
              (values[`${provider.id}:${field.key}`] = event.currentTarget.value)}
          >
            {#each field.options ?? [] as option (option.value)}
              <option value={option.value}>{t(option.label)}</option>
            {/each}
          </select>
        {:else}
          <input
            class="orden-field"
            type={typeOf(field)}
            inputmode={field.kind === 'phone' ? 'tel' : undefined}
            autocomplete={field.kind === 'password'
              ? 'current-password'
              : field.kind === 'phone'
                ? 'tel'
                : 'off'}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            spellcheck="false"
            disabled={busy}
            value={valueOf(field)}
            oninput={(event) => (values[`${provider.id}:${field.key}`] = event.currentTarget.value)}
          />
        {/if}
        {#if field.note}<span class="note">{t(field.note)}</span>{/if}
      </label>
    {/each}
    {#if provider.warning}
      <div class="warning" role="note">
        <p>{t(provider.warning)}</p>
        <label class="understood">
          <input type="checkbox" bind:checked={understood} disabled={busy} />
          <span>{t('I understand and want to connect anyway')}</span>
        </label>
      </div>
    {/if}
  {/if}
  {#if busy}<SignIn />{/if}
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
  <div class="actions">
    <button class="orden-button is-quiet" type="button" onclick={stop}>{t('Cancel')}</button>
    <button class="orden-button" type="submit" disabled={!ready || busy}
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

  .services {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .service {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .mark {
    width: 14px;
    height: 14px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .note {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .warning {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--danger, var(--border));
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
  }

  .warning p {
    margin: 0;
    color: var(--text-strong);
  }

  .understood {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--muted-strong);
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
