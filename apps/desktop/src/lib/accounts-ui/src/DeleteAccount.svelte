<script lang="ts">
  import { onMount } from 'svelte'

  import { account } from '../../accounts/src/api'
  import { fromServer, request } from '../../accounts/src/api'
  import { region } from '../../region'
  import { message } from '../../message'
  import { dur, fade } from '../../motion'

  const { onend }: { onend: () => void } = $props()

  const shared = $derived(
    new Intl.ListFormat(region()).format(
      account.spaces.filter((one) => one.role === 'owner' && one.shared).map((one) => one.name),
    ),
  )

  let stage = $state<'codes' | 'sure'>('codes')
  let second = $state(false)
  let code = $state('')
  let fromApp = $state('')
  let busy = $state(false)
  let wrong = $state<string | null>(null)
  let resendIn = $state(0)
  let field = $state<HTMLInputElement | null>(null)

  let ticket: string | null = null

  async function mail() {
    const token = account.accountToken
    if (!token || busy) return

    busy = true
    wrong = null

    try {
      const sent = await request<{ resendIn: number; second: boolean }>('/v1/account/delete/code', {
        token,
        body: {},
      })
      second = sent.second
      countDown(sent.resendIn)
      field?.focus()
    } catch (error) {
      wrong = message(error, 'could not reach the server')
    } finally {
      busy = false
    }
  }

  async function prove() {
    const token = account.accountToken
    if (!token || busy) return

    busy = true
    wrong = null

    try {
      const proved = await request<{ ticket: string }>('/v1/account/delete/verify', {
        token,
        body: { code, ...(second ? { second: fromApp } : {}) },
      })
      ticket = proved.ticket
      stage = 'sure'
    } catch (error) {
      wrong = message(error, 'that code is not right')
    } finally {
      busy = false
    }
  }

  async function leave() {
    const token = account.accountToken
    if (!token || !ticket || busy) return

    busy = true
    wrong = null

    try {
      await request<{ ok: true }>('/v1/account', { method: 'DELETE', token, body: { ticket } })
    } catch (error) {
      if (!(fromServer(error) && error.status === 401)) {
        wrong = message(error, 'that did not work')
        busy = false
        return
      }

      const gone = await wentWith(ticket)
      if (gone !== true) {
        await account.recheck()
        account.error =
          gone === false
            ? 'Signed out elsewhere; the account was not deleted. Sign in again to delete it.'
            : 'Signed out; sign in again to see whether the account is still there.'
        account.open = true
        onend()
        return
      }
    }

    void account.signOut('kept')
    onend()
  }

  async function wentWith(held: string): Promise<boolean | null> {
    try {
      const asked = await request<{ gone?: unknown }>('/v1/account/left', {
        body: { ticket: held },
      })
      return typeof asked.gone === 'boolean' ? asked.gone : null
    } catch {
      return null
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined

  function countDown(seconds: number) {
    clearInterval(timer)
    resendIn = seconds

    timer = setInterval(() => {
      resendIn -= 1
      if (resendIn <= 0) clearInterval(timer)
    }, 1000)
  }

  onMount(() => {
    void mail()
    return () => clearInterval(timer)
  })
</script>

<div class="leaving" transition:fade={{ duration: dur(130) }}>
  {#if stage === 'codes'}
    <form
      onsubmit={(event) => {
        event.preventDefault()
        void prove()
      }}
    >
      <label class="orden-setting setting">
        <span class="name">Code sent to <strong>{account.user?.email}</strong></span>
        <input
          class="orden-field is-value code"
          bind:this={field}
          bind:value={code}
          placeholder="000000"
          aria-label="Code"
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
        />
      </label>
      {#if second}
        <label class="orden-setting setting" transition:fade={{ duration: dur(130) }}>
          <span class="name">App code to delete</span>
          <input
            class="orden-field is-value code"
            bind:value={fromApp}
            placeholder="000000"
            aria-label="App code to delete"
            inputmode="numeric"
            autocomplete="one-time-code"
            spellcheck="false"
          />
        </label>
      {/if}
      <div class="orden-setting setting">
        <button
          type="button"
          class="orden-chip is-quiet resend"
          disabled={busy || resendIn > 0}
          onclick={() => void mail()}
        >
          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Send a new code'}
        </button>
        <button type="button" class="orden-chip is-quiet" onclick={onend}>Cancel</button>
        <button type="submit" class="orden-chip" disabled={busy || !code.trim()}> Continue </button>
      </div>
    </form>
  {:else}
    {#if shared}
      <p class="hint" transition:fade={{ duration: dur(130) }}>
        Also gone for everyone in {shared}.
      </p>
    {/if}
    <button class="orden-action is-danger" disabled={busy} onclick={() => void leave()}>
      Delete now
    </button>
    <button class="orden-action" disabled={busy} onclick={onend}>Cancel</button>
  {/if}

  {#if wrong}
    <p class="hint bad" transition:fade={{ duration: dur(130) }}>{wrong}</p>
  {/if}
</div>

<style>
  .leaving {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .setting .name {
    flex: 1;
  }

  .name strong {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .resend {
    margin-inline-end: auto;
  }

  .setting > .code {
    flex: none;
    inline-size: 8rem;
  }

  .hint {
    margin: var(--space-1) 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.bad {
    color: var(--danger);
  }

  :global(.sheet.phone) .setting {
    gap: var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) var(--touch-pad);
    font-size: var(--touch-text);
  }

  :global(.sheet.phone) .hint {
    padding: 0 var(--touch-pad);
  }
</style>
