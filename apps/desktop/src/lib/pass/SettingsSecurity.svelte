<script lang="ts">
  import { pinIn } from '@orden/pass/device'
  import { deliver } from '../export/save'
  import { t } from '../i18n.svelte'
  import { deviceName } from '../protect/device'
  import Select from '../Select.svelte'
  import ChangePassword from './ChangePassword.svelte'
  import { copyField } from './copied'
  import {
    CLIPBOARD_CLEAR,
    type ClipboardClear,
    type LockWay,
    RELOCK_AFTER,
    type RelockAfter,
  } from './settings'
  import { clearWord, relockWord } from './settings-words'
  import { pass } from './store.svelte'

  let choosingPin = $state(false)
  let pin = $state('')
  let changing = $state(false)
  let recoveryPassword = $state('')
  let askingRecovery = $state(false)
  let recovery = $state<string | null>(null)
  let wrong = $state('')
  let busy = $state(false)

  const ways = $derived<{ value: LockWay; label: string }[]>([
    ...(pass.canPin ? [{ value: 'pin' as const, label: t('PIN') }] : []),
    ...(pass.canDevice ? [{ value: 'device' as const, label: deviceName() }] : []),
    { value: 'password', label: t('Pass password') },
  ])

  async function chooseWay(way: LockWay) {
    wrong = ''
    if (way === 'pin') {
      choosingPin = true
      return
    }
    choosingPin = false
    if (!(await pass.useLock(way))) wrong = t('This device could not keep the key.')
  }

  async function keptPin(event: SubmitEvent) {
    event.preventDefault()
    const chosen = pinIn(pin)
    if (chosen === null) {
      wrong = t('A PIN is 4 to 12 digits')
      return
    }
    busy = true
    const ok = await pass.useLock('pin', chosen)
    busy = false
    if (!ok) wrong = t('This device could not keep the key.')
    else {
      choosingPin = false
      pin = ''
    }
  }

  async function madeRecovery(event: SubmitEvent) {
    event.preventDefault()
    busy = true
    const made = await pass.newRecovery(recoveryPassword)
    busy = false
    recoveryPassword = ''
    if (made === null) {
      wrong = t('Wrong password')
      return
    }
    wrong = ''
    askingRecovery = false
    recovery = made
  }

  function downloaded(code: string) {
    const text = `${t('Orden Pass recovery key')}\n\n${code}\n`
    void deliver(t('Orden Pass recovery key'), 'txt', t('Text'), { text, mime: 'text/plain' })
  }
</script>

<div class="card">
  <div class="nib-setting row">
    <span class="name">{t('Unlock with')}</span>
    <Select
      label={t('Unlock with')}
      value={choosingPin ? 'pin' : pass.settings.lock}
      options={ways}
      onchange={(value: string) => void chooseWay(value as LockWay)}
    />
  </div>
  {#if choosingPin}
    <form class="nib-setting row" onsubmit={keptPin}>
      <span class="name">{t('New PIN')}</span>
      <input
        class="nib-field is-value"
        type="password"
        inputmode="numeric"
        autocomplete="off"
        placeholder={t('New PIN')}
        aria-label={t('New PIN')}
        bind:value={pin}
      />
      <button class="nib-chip" type="submit" disabled={busy || pin === ''}>{t('Use PIN')}</button>
    </form>
    <p class="hint">
      {t(
        'A PIN keeps out someone at this device. It does not stop a program running as you, which could read the seal and try every PIN.',
      )}
    </p>
  {/if}
  <div class="nib-setting row">
    <span class="name">{t('Lock after')}</span>
    <Select
      label={t('Lock after')}
      value={String(pass.settings.relockAfter)}
      options={RELOCK_AFTER.map((one) => ({ value: String(one), label: relockWord(one) }))}
      onchange={(value: string) => pass.setSetting('relockAfter', Number(value) as RelockAfter)}
    />
  </div>
  <div class="nib-setting row">
    <span class="name">{t('Clear clipboard after')}</span>
    <Select
      label={t('Clear clipboard after')}
      value={String(pass.settings.clipboardClear)}
      options={CLIPBOARD_CLEAR.map((one) => ({ value: String(one), label: clearWord(one) }))}
      onchange={(value: string) =>
        pass.setSetting('clipboardClear', Number(value) as ClipboardClear)}
    />
  </div>
</div>
{#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}

<h3 class="nib-section">{t('Pass password')}</h3>
<div class="card padded">
  {#if changing}
    <ChangePassword ondone={() => (changing = false)} oncancel={() => (changing = false)} />
  {:else}
    <div class="nib-setting">
      <span class="name">{t('It encrypts everything in Pass.')}</span>
      <button class="nib-chip" type="button" onclick={() => (changing = true)}
        >{t('Change Pass password')}</button
      >
    </div>
    <p class="hint" data-old-secrets>
      {t(
        'The keys inside Pass stay the same, so the old password still opens a copy of Pass somebody kept from before.',
      )}
    </p>
  {/if}
</div>

<h3 class="nib-section">{t('Recovery key')}</h3>
<div class="card padded">
  {#if recovery}
    <output class="code">{recovery}</output>
    <div class="buttons">
      <button
        class="nib-chip"
        type="button"
        onclick={() => recovery && void copyField(t('Recovery key'), recovery)}>{t('Copy')}</button
      >
      <button class="nib-chip" type="button" onclick={() => recovery && downloaded(recovery)}
        >{t('Download')}</button
      >
      <button class="nib-button" type="button" onclick={() => (recovery = null)}
        >{t('I saved it')}</button
      >
    </div>
  {:else if askingRecovery}
    <form class="nib-setting" onsubmit={madeRecovery}>
      <span class="name">{t('Pass password')}</span>
      <input
        class="nib-field is-value"
        type="password"
        autocomplete="current-password"
        placeholder={t('Pass password')}
        aria-label={t('Pass password')}
        bind:value={recoveryPassword}
      />
      <button class="nib-chip" type="submit" disabled={busy || recoveryPassword === ''}
        >{t('Make a new key')}</button
      >
    </form>
  {:else}
    <div class="nib-setting">
      <span class="name">{t('A new key stops the old one from opening Pass here.')}</span>
      <button class="nib-chip" type="button" onclick={() => (askingRecovery = true)}
        >{t('New recovery key')}</button
      >
    </div>
    <p class="hint">
      {t('The old key still opens a copy of Pass somebody kept from before.')}
    </p>
  {/if}
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card.padded {
    padding: var(--space-2) var(--space-3);
  }

  .row {
    padding: var(--space-1) var(--space-3);
  }

  .row + .row {
    border-top: 1px solid var(--line);
  }

  .hint {
    margin: 0;
    padding: 0 var(--space-3) var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .nib-section {
    margin: var(--space-3) 0 0;
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .code {
    display: block;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--bg);
    font-family: var(--font-mono);
    line-height: 1.6;
    overflow-wrap: anywhere;
    -webkit-user-select: all;
    user-select: all;
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-2);
  }
</style>
