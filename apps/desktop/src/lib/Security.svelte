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
        <span class="hint ok">{t('On')}</span>
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
        <input
          class="field"
          bind:value={code}
          placeholder={t('Code from the app')}
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
      <Copyable value={codes.join('\n')} label={t('Recovery codes')} />
    </div>
  {/if}

  {#if factor?.on}
    <div class="card">
      <div class="setting">
        <span class="name">{t('Recovery codes left')}</span>
        <span class="hint">{factor.codesLeft}</span>
      </div>
      <div class="setting">
        <input
          class="field"
          bind:value={code}
          placeholder={t('Code from the app')}
          aria-label={t('Code from the app')}
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
      <span class="hint">{when(session.lastUsedAt)}</span>
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
  /* Which row is this device, said quietly beside its name rather than as a
     badge: it is a fact about the row, not a state to notice. */
  small {
    margin-left: var(--space-2);
    font-size: var(--text-xs);
    color: var(--muted);
  }
</style>
