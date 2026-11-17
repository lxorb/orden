<script lang="ts">
  import { account, request } from '../../accounts/src/api'
  import { message } from '../../ui-kit/src/api'
  import { dur, fade } from '../../platform/src/api'

  interface Held {
    email: string
    second: string | null
  }

  let second = $state<string | null>(null)
  let adding = $state<'primary' | 'second' | null>(null)
  let address = $state('')
  let sent = $state(false)
  let code = $state('')
  let asksApp = $state(false)
  let fromApp = $state('')
  let busy = $state(false)
  let wrong = $state<string | null>(null)

  async function asked<T>(path: string, options: Parameters<typeof request>[1] = {}) {
    const token = account.accountToken
    if (!token) throw new Error('signed out')
    return await request<T>(`/v1/account/addresses${path}`, { token, ...options })
  }

  function took(held: Held) {
    second = held.second
    if (account.user && account.user.email !== held.email) void account.reread()
  }

  $effect(() => {
    if (account.user) void asked<Held>('').then(took, () => undefined)
  })

  function start(as: 'primary' | 'second') {
    adding = as
    address = ''
    sent = false
    code = ''
    fromApp = ''
    wrong = null
  }

  async function run(work: () => Promise<void>, fallback: string) {
    if (busy) return
    busy = true
    wrong = null
    try {
      await work()
    } catch (error) {
      wrong = message(error, fallback)
    } finally {
      busy = false
    }
  }

  const mail = () =>
    run(async () => {
      const answer = await asked<{ second: boolean }>('/code', { body: { email: address } })
      asksApp = answer.second
      sent = true
    }, 'could not send the code')

  const confirm = () =>
    run(async () => {
      took(
        await asked<Held>('', {
          body: { email: address, code, as: adding, ...(asksApp ? { second: fromApp } : {}) },
        }),
      )
      adding = null
    }, 'that code is not right')

  const promote = () =>
    run(
      async () => took(await asked<Held>('/second/primary', { method: 'POST' })),
      'that did not work',
    )

  const remove = () =>
    run(async () => took(await asked<Held>('/second', { method: 'DELETE' })), 'that did not work')
</script>

<div class="orden-setting setting">
  <span class="name">Email</span>
  <span class="orden-field is-value is-read">{account.user?.email}</span>
  {#if !adding}
    <button class="orden-chip is-quiet" aria-label="Change email" onclick={() => start('primary')}
      >Change</button
    >
  {/if}
</div>
<div class="orden-setting setting">
  <span class="name">Second email</span>
  {#if second}
    <span class="orden-field is-value is-read">{second}</span>
    {#if !adding}
      <button class="orden-chip is-quiet" disabled={busy} onclick={() => void promote()}
        >Make primary</button
      >
      <button class="orden-chip is-quiet" disabled={busy} onclick={() => void remove()}
        >Remove</button
      >
    {/if}
  {:else if !adding}
    <button
      class="orden-chip is-quiet"
      aria-label="Add a second email"
      onclick={() => start('second')}>Add</button
    >
  {/if}
</div>

{#if adding}
  <form
    class="adding"
    transition:fade={{ duration: dur(130) }}
    onsubmit={(event) => {
      event.preventDefault()
      void (sent ? confirm() : mail())
    }}
  >
    <label class="orden-setting setting">
      <span class="name">{adding === 'primary' ? 'New email' : 'Second email'}</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="orden-field is-value"
        type="email"
        bind:value={address}
        placeholder="you@example.com"
        aria-label={adding === 'primary' ? 'New email' : 'Second email'}
        spellcheck="false"
        autofocus
        disabled={sent}
      />
    </label>
    {#if sent}
      <label class="orden-setting setting" transition:fade={{ duration: dur(130) }}>
        <span class="name">Code sent to <strong>{address}</strong></span>
        <input
          class="orden-field is-value code"
          bind:value={code}
          placeholder="000000"
          aria-label="Code"
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
        />
      </label>
      {#if asksApp}
        <label class="orden-setting setting" transition:fade={{ duration: dur(130) }}>
          <span class="name">App code</span>
          <input
            class="orden-field is-value code"
            bind:value={fromApp}
            placeholder="000000"
            aria-label="App code"
            inputmode="numeric"
            autocomplete="one-time-code"
            spellcheck="false"
          />
        </label>
      {/if}
      {#if adding === 'primary'}
        <p class="hint">
          Your account will sign in with the new address. The old one gets a link to undo it for 7
          days.
        </p>
      {/if}
    {/if}
    <div class="orden-setting setting">
      <button type="button" class="orden-chip is-quiet" onclick={() => (adding = null)}
        >Cancel</button
      >
      <button
        type="submit"
        class="orden-chip"
        disabled={busy || !address.trim() || (sent && !code.trim())}
      >
        {sent ? 'Confirm' : 'Send code'}
      </button>
    </div>
  </form>
{/if}

{#if wrong}
  <p class="hint bad" transition:fade={{ duration: dur(130) }}>{wrong}</p>
{/if}

<style>
  .adding {
    display: flex;
    flex-direction: column;
  }

  .setting .name {
    flex: 1;
  }

  .name strong {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .setting > .code {
    flex: none;
    inline-size: 8rem;
  }

  .adding .setting:last-child {
    justify-content: flex-end;
  }

  .hint {
    margin: var(--space-1) 0;
    padding: 0 var(--space-3);
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .hint.bad {
    color: var(--danger);
  }
</style>
