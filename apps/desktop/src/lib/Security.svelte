<script lang="ts">
  import { fade } from 'svelte/transition'

  import { account } from './account.svelte'
  import { api, type RemoteSession, type SecondState } from './api'
  import Copyable from './Copyable.svelte'
  import CopyButton from './CopyButton.svelte'
  import { i18n, t } from './i18n.svelte'
  import { dur } from './motion'

  let factor = $state<SecondState | null>(null)
  let sessions = $state<RemoteSession[]>([])
  let busy = $state(false)
  let wrong = $state<string | null>(null)

  let secret = $state<{ holding: string; secret: string; uri: string } | null>(null)
  let code = $state('')
  let codes = $state<string[] | null>(null)
  let square = $state<string | null>(null)

  $effect(() => {
    const uri = secret?.uri
    if (!uri) {
      square = null
      return
    }

    let current = true
    void import('uqr')
      .then(({ renderSVG }) => {
        if (current) square = renderSVG(uri, { border: 1, pixelSize: 6 })
      })
      .catch(() => {
        // The secret underneath is the same secret; a square that could not be
        // drawn costs a reader one paste rather than the setting.
      })

    return () => {
      current = false
    }
  })

  async function look() {
    const token = account.accountToken
    if (!token) return

    try {
      factor = await api.second(token)
      sessions = (await api.sessions(token)).sessions
    } catch {
      factor = null
    }
  }

  $effect(() => {
    void look()
  })

  async function begin() {
    const token = account.accountToken
    if (!token || busy) return

    busy = true
    wrong = null

    try {
      secret = await api.beginSecond(token)
      codes = null
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That did not work.')
    } finally {
      busy = false
    }
  }

  async function confirm() {
    const token = account.accountToken
    if (!token || !secret || busy) return

    busy = true
    wrong = null

    try {
      codes = (await api.confirmSecond(token, secret.holding, code)).recovery
      secret = null
      code = ''
      await look()
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That code is not right.')
    } finally {
      busy = false
    }
  }

  async function turnOff() {
    const token = account.accountToken
    if (!token || busy) return

    busy = true
    wrong = null

    try {
      await api.endSecond(token, code)
      code = ''
      codes = null
      await look()
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That code is not right.')
    } finally {
      busy = false
    }
  }

  async function freshCodes() {
    const token = account.accountToken
    if (!token || busy) return

    busy = true
    wrong = null

    try {
      codes = (await api.freshRecovery(token, code)).recovery
      code = ''
      await look()
    } catch (error) {
      wrong = error instanceof Error ? error.message : t('That code is not right.')
    } finally {
      busy = false
    }
  }

  async function end(session: RemoteSession) {
    const token = account.accountToken
    if (!token) return

    await api.endSession(token, session.id).catch(() => undefined)
    await look()
  }

  async function endOthers() {
    const token = account.accountToken
    if (!token) return

    await api.endOtherSessions(token).catch(() => undefined)
    await look()
  }

  const when = (stamp: number | null) =>
    stamp === null ? t('Never') : i18n.when(stamp, { dateStyle: 'short', timeStyle: 'short' })
</script>

<h3>{t('Signing in')}</h3>

{#if factor?.possible === false}
  <p class="hint">{t('This service cannot keep a second factor.')}</p>
{:else}
  <div class="card">
    <div class="nib-setting setting">
      <span class="name">{t('Ask for a code from an app')}</span>
      {#if factor?.on}
        <span class="text">{t('On')}</span>
      {:else}
        <button class="nib-chip" disabled={busy} onclick={() => void begin()}>{t('Turn on')}</button
        >
      {/if}
    </div>
  </div>

  {#if secret}
    <div class="card" transition:fade={{ duration: dur(130) }}>
      <p class="hint">{t('Scan this with your authenticator app, then type its code.')}</p>
      {#if square}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <figure class="square">{@html square}</figure>
      {/if}
      <Copyable value={secret.secret} label={t('Secret')} />
      <div class="nib-setting setting">
        <span class="name">{t('Code from the app')}</span>
        <input
          class="nib-field is-value narrow"
          bind:value={code}
          placeholder="000000"
          aria-label={t('Code from the app')}
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
        />
        <button class="nib-chip" disabled={busy} onclick={() => void confirm()}
          >{t('Confirm')}</button
        >
      </div>
    </div>
  {/if}

  {#if codes}
    <div class="card" transition:fade={{ duration: dur(130) }}>
      <p class="note">
        {t('Keep these somewhere safe. Each works once, and they are not shown again.')}
      </p>
      <ul class="codes">
        {#each codes as one (one)}
          <li>{one}</li>
        {/each}
      </ul>
      <CopyButton value={codes.join('\n')} wide />
    </div>
  {/if}

  {#if factor?.on}
    <div class="card">
      <div class="nib-setting setting">
        <span class="name">{t('Recovery codes left')}</span>
        <span class="text">{factor.codesLeft}</span>
      </div>
      <div class="nib-setting setting">
        <span class="name">{t('Code to change sign-in')}</span>
        <input
          class="nib-field is-value"
          bind:value={code}
          placeholder="000000"
          aria-label={t('Code to change sign-in')}
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
        />
      </div>
      <button class="nib-action" disabled={busy} onclick={() => void freshCodes()}>
        {t('New recovery codes')}
      </button>
      <button class="nib-action is-danger" disabled={busy} onclick={() => void turnOff()}>
        {t('Turn off')}
      </button>
    </div>
  {/if}
{/if}

{#if wrong}
  <p class="hint bad">{wrong}</p>
{/if}

<h3>{t('Signed in on')}</h3>

<div class="card">
  {#each sessions as session (session.id)}
    <div class="nib-setting setting">
      <span class="name">
        {session.name || t('A device')}
        {#if session.current}<small>{t('this one')}</small>{/if}
      </span>
      <span class="text">{when(session.lastUsedAt)}</span>
      {#if !session.current}
        <button class="nib-chip" onclick={() => void end(session)}>{t('End')}</button>
      {/if}
    </div>
  {/each}
</div>

{#if sessions.length > 1}
  <button class="nib-action is-danger" onclick={() => void endOthers()}>
    {t('End every other session')}
  </button>
{/if}

<style>
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
  }

  .text {
    overflow: hidden;
    color: var(--muted-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .square {
    align-self: flex-start;
    margin: var(--space-2) 0;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: #fff;
    line-height: 0;
  }

  .square :global(svg) {
    display: block;
    width: 8.5rem;
    height: 8.5rem;
  }

  .codes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 3px var(--space-3);
    margin: 0;
    padding: var(--space-2) 0;
    list-style: none;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-strong);
  }

  .setting > .narrow {
    flex: none;
    inline-size: 8rem;
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.bad {
    color: var(--danger);
  }

  small {
    margin-inline-start: var(--space-2);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .setting + .setting::before {
    content: '';
    position: absolute;
    top: 0;
    inset-inline-start: var(--touch-pad);
    inset-inline-end: 0;
    height: 1px;
    background: var(--line);
  }
</style>
