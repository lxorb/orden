<script lang="ts">
  import { account } from '../../accounts/src/api'
  import { api, type RemoteSession, type SecondState } from '../../accounts/src/api'
  import { Copyable } from '../../ui-controls/src/api'
  import { CopyButton } from '../../ui-controls/src/api'
  import { localDate } from '../../platform/src/api'
  import { dur, fade } from '../../platform/src/api'

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
      wrong = error instanceof Error ? error.message : 'That did not work.'
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
      wrong = error instanceof Error ? error.message : 'That code is not right.'
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
      wrong = error instanceof Error ? error.message : 'That code is not right.'
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
      wrong = error instanceof Error ? error.message : 'That code is not right.'
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
    stamp === null ? 'Never' : localDate(stamp, { dateStyle: 'short', timeStyle: 'short' })
</script>

<h3>Signing in</h3>

{#if factor?.possible === false}
  <p class="hint">This service cannot keep a second factor.</p>
{:else}
  <div class="card">
    <div class="orden-setting setting">
      <span class="name">Two-factor authentication</span>
      {#if factor?.on}
        <span class="text">On</span>
      {:else}
        <button class="orden-chip" disabled={busy} onclick={() => void begin()}>Turn on</button>
      {/if}
    </div>
  </div>

  {#if secret}
    <div class="card" transition:fade={{ duration: dur(130) }}>
      <p class="hint">Scan this with your authenticator app, then type its code.</p>
      {#if square}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <figure class="square">{@html square}</figure>
      {/if}
      <Copyable value={secret.secret} label="Secret" />
      <div class="orden-setting setting">
        <span class="name">Code from the app</span>
        <input
          class="orden-field is-value narrow"
          bind:value={code}
          placeholder="000000"
          aria-label="Code from the app"
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
        />
        <button class="orden-chip" disabled={busy} onclick={() => void confirm()}>Confirm</button>
      </div>
    </div>
  {/if}

  {#if codes}
    <div class="card" transition:fade={{ duration: dur(130) }}>
      <p class="note">Keep these somewhere safe. Each works once, and they are not shown again.</p>
      <ul class="codes" dir="ltr">
        {#each codes as one (one)}
          <li>{one}</li>
        {/each}
      </ul>
      <CopyButton value={codes.join('\n')} wide />
    </div>
  {/if}

  {#if factor?.on}
    <div class="card">
      <div class="orden-setting setting">
        <span class="name">Recovery codes left</span>
        <span class="text">{factor.codesLeft}</span>
      </div>
      <div class="orden-setting setting">
        <span class="name">Code to change sign-in</span>
        <input
          class="orden-field is-value"
          bind:value={code}
          placeholder="000000"
          aria-label="Code to change sign-in"
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
        />
      </div>
      <button class="orden-action" disabled={busy} onclick={() => void freshCodes()}>
        New recovery codes
      </button>
      <button class="orden-action is-danger" disabled={busy} onclick={() => void turnOff()}>
        Turn off
      </button>
    </div>
  {/if}
{/if}

{#if wrong}
  <p class="hint bad">{wrong}</p>
{/if}

<h3>Signed in on</h3>

<div class="card">
  {#each sessions as session (session.id)}
    <div class="orden-setting setting">
      <span class="name">
        {session.name || 'A device'}
        {#if session.current}<small>this one</small>{/if}
      </span>
      <span class="text">{when(session.lastUsedAt)}</span>
      {#if !session.current}
        <button class="orden-chip" onclick={() => void end(session)}>End</button>
      {/if}
    </div>
  {/each}
</div>

{#if sessions.length > 1}
  <button class="orden-action is-danger" onclick={() => void endOthers()}>
    End every other session
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
