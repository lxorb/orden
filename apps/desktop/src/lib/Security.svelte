<script lang="ts">
  /** The two halves of an account being yours: a second code when signing in,
   *  and the list of devices that are signed in now.
   *
   *  The list is the half that matters more and the half nobody had: a session
   *  row said nothing but its own hash, so "is anybody else signed in as me" had
   *  no answer and nothing could be done about it. Now each says which device
   *  opened it and when it was last seen, and any of them can be ended from
   *  here.
   *
   *  The factor is six digits out of an authenticator app rather than a passkey,
   *  and services/sync/src/second.ts says why in as many words. Turning it on is
   *  three steps and the last one is the recovery codes, which are shown once. */

  import { fade } from 'svelte/transition'

  import { account } from './account.svelte'
  import { api, type RemoteSession, type SecondState } from './api'
  import Copyable from './Copyable.svelte'
  import CopyButton from './CopyButton.svelte'
  import { t } from './i18n.svelte'
  import { dur } from './motion'

  let factor = $state<SecondState | null>(null)
  let sessions = $state<RemoteSession[]>([])
  let busy = $state(false)
  let wrong = $state<string | null>(null)

  /** The three steps of turning it on: nothing, a secret to put in the app, and
   *  the codes to keep. */
  let secret = $state<{ holding: string; secret: string; uri: string } | null>(null)
  let code = $state('')
  let codes = $state<string[] | null>(null)

  async function look() {
    const token = account.accountToken
    if (!token) return

    try {
      factor = await api.second(token)
      sessions = (await api.sessions(token)).sessions
    } catch {
      // A pane that cannot say is a pane that says nothing, which is better
      // than a pane that says something wrong about a security setting.
      factor = null
    }
  }

  // Read once when the pane appears, and again after anything changes it.
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
    stamp === null
      ? t('Never')
      : new Date(stamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
</script>

<h3>{t('Signing in')}</h3>

{#if factor?.possible === false}
  <p class="hint">{t('This service cannot keep a second factor.')}</p>
{:else}
  <div class="card">
    <div class="setting">
      <span class="name">{t('Ask for a code from an app')}</span>
      {#if factor?.on}
        <span class="text">{t('On')}</span>
      {:else}
        <button class="pill" disabled={busy} onclick={() => void begin()}>{t('Turn on')}</button>
      {/if}
    </div>
  </div>

  {#if secret}
    <div class="card" transition:fade={{ duration: dur(130) }}>
      <p class="hint">{t('Put this into your authenticator app, then type its code.')}</p>
      <Copyable value={secret.secret} label={t('Secret')} />
      <div class="setting">
        <span class="name">{t('Code from the app')}</span>
        <input
          class="inline narrow"
          bind:value={code}
          placeholder="000000"
          aria-label={t('Code from the app')}
          inputmode="numeric"
          spellcheck="false"
        />
        <button class="pill" disabled={busy} onclick={() => void confirm()}>{t('Confirm')}</button>
      </div>
    </div>
  {/if}

  {#if codes}
    <div class="card" transition:fade={{ duration: dur(130) }}>
      <p class="note">
        {t('Keep these somewhere safe. Each works once, and they are not shown again.')}
      </p>
      <!-- All ten, read as a block rather than squeezed into a field: they are
           shown once, and a line that ends in an ellipsis is not somewhere safe. -->
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
      <div class="setting">
        <span class="name">{t('Recovery codes left')}</span>
        <span class="text">{factor.codesLeft}</span>
      </div>
      <div class="setting">
        <span class="name">{t('Code from the app')}</span>
        <input
          class="inline"
          bind:value={code}
          placeholder="000000"
          aria-label={t('Code from the app')}
          inputmode="numeric"
          spellcheck="false"
        />
      </div>
      <button class="action" disabled={busy} onclick={() => void freshCodes()}>
        {t('New recovery codes')}
      </button>
      <button class="action danger" disabled={busy} onclick={() => void turnOff()}>
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
    <div class="setting">
      <span class="name">
        {session.name || t('A device')}
        {#if session.current}<small>{t('this one')}</small>{/if}
      </span>
      <span class="text">{when(session.lastUsedAt)}</span>
      {#if !session.current}
        <button class="pill" onclick={() => void end(session)}>{t('End')}</button>
      {/if}
    </div>
  {/each}
</div>

{#if sessions.length > 1}
  <button class="action danger" onclick={() => void endOthers()}>
    {t('End every other session')}
  </button>
{/if}

<style>
  /* The settings pane's own shapes. A section in its own component does not
     inherit the panel's styles - those are scoped to it - so the ones this pane
     uses are here with the panel's values, the way McpSetup and RecentlyDeleted
     carry theirs. See SettingsPanel.svelte. */
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--muted-strong);
  }

  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 38px;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
  }

  .setting .name {
    flex: 1;
    min-width: 0;
  }

  /* A value at the right of its row: what this row says rather than what it
     does. */
  .text {
    overflow: hidden;
    color: var(--muted-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* An input in a row: the value at the right, no box until it is typed in. */
  .inline {
    flex: none;
    width: 12rem;
    padding: 6px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: right;
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .inline::placeholder {
    color: var(--muted);
  }

  .inline:focus {
    border-color: var(--accent);
    background: var(--bg);
  }

  /* The ten recovery codes, as many to a line as fit. */
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

  /* Beside a button, so the field takes what the digits need and no more. */
  .inline.narrow {
    width: 8rem;
  }

  /* A small action at the end of a row, where the control would be. */
  .pill {
    flex: none;
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 99px;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .pill:active {
    background: var(--accent-soft);
  }

  .pill:disabled {
    opacity: 0.5;
  }

  /* An action in a card: full width, quiet until pointed at. */
  .action {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 34px;
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    text-align: left;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .inline:hover {
      border-color: var(--line);
    }

    .pill:hover {
      border-color: var(--accent);
      color: var(--accent);
    }

    .action:hover:not(:disabled) {
      color: var(--text-strong);
    }

    .action.danger:hover:not(:disabled) {
      color: var(--danger);
    }
  }

  .action:disabled {
    opacity: 0.5;
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

  /* Which row is this device, said quietly beside its name rather than as a
     badge: it is a fact about the row, not a state to notice. */
  small {
    margin-left: var(--space-2);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  /* A phone draws the box, the touch rows, and the hairlines between them. The
     sheet is the panel's, so that half of the selector is global and the rows
     are this pane's. */
  :global(.sheet.phone) .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    overflow: hidden;
  }

  :global(.sheet.phone) .inline {
    width: 55%;
    padding: 8px 10px;
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .inline.narrow {
    width: 8rem;
  }

  :global(.sheet.phone) .setting {
    position: relative;
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .action {
    position: relative;
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    color: var(--accent);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .action.danger {
    color: var(--danger);
  }

  :global(.sheet.phone) .setting + .setting::before,
  :global(.sheet.phone) .action + .action::before {
    content: '';
    position: absolute;
    top: 0;
    left: var(--touch-pad);
    right: 0;
    height: 1px;
    background: var(--line);
  }
</style>
