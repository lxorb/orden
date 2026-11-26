<script lang="ts">
  import { untrack } from 'svelte'
  import { account, request } from '../../accounts/src/api'
  import { message } from '../../ui-kit/src/api'
  import { EditRow, EditSheet } from '../../ui-controls/src/api'

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
  const LEFT = new Error('another account')
  async function asked<T>(path: string, options: Parameters<typeof request>[1] = {}) {
    const token = account.accountToken
    if (!token) throw new Error('signed out')
    const answer = await request<T>(`/v1/account/addresses${path}`, { token, ...options })
    if (account.accountToken !== token) throw LEFT
    return answer
  }
  function took(held: Held) {
    second = held.second
    if (account.user && account.user.email !== held.email) void account.reread()
  }
  $effect(() => {
    if (!account.accountToken) return
    untrack(() => {
      second = null
      adding = null
      address = ''
      sent = false
      code = ''
      asksApp = false
      fromApp = ''
      busy = false
      wrong = null
    })
    void asked<Held>('').then(took, () => undefined)
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
    const token = account.accountToken
    busy = true
    wrong = null
    try {
      await work()
    } catch (error) {
      if (error !== LEFT) wrong = message(error, fallback)
    } finally {
      if (account.accountToken === token) busy = false
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
    run(async () => {
      took(await asked<Held>('/second/primary', { method: 'POST' }))
      adding = null
    }, 'that did not work')
  const remove = () =>
    run(async () => {
      took(await asked<Held>('/second', { method: 'DELETE' }))
      adding = null
    }, 'that did not work')
</script>

<EditRow label="Email" value={account.user?.email ?? null} onedit={() => start('primary')} />
<EditRow label="Second email" value={second} empty="None" onedit={() => start('second')} />

<EditSheet
  open={adding !== null}
  title={adding === 'primary' ? 'Change email' : second ? 'Second email' : 'Add a second email'}
  {busy}
  {wrong}
  word={sent ? 'Confirm' : 'Send code'}
  ready={!!address.trim() && (!sent || !!code.trim())}
  onsave={() => void (sent ? confirm() : mail())}
  onclose={() => (adding = null)}
>
  {#if adding === 'second' && second}
    <div class="current">
      <span class="what">{second}</span>
      <button type="button" class="orden-chip" disabled={busy} onclick={() => void promote()}>Make primary</button>
      <button type="button" class="orden-chip is-danger" disabled={busy} onclick={() => void remove()}>Remove</button>
    </div>
  {/if}
  <label
    >{adding === 'primary' ? 'New email' : second ? 'Another second email' : 'Second email'}<input
      class="orden-field"
      type="email"
      bind:value={address}
      placeholder="you@example.com"
      spellcheck="false"
      disabled={sent}
      data-lands
    /></label
  >
  {#if sent}
    <label
      >Code sent to {address}<input
        class="orden-field"
        bind:value={code}
        placeholder="000000"
        aria-label="Code"
        inputmode="numeric"
        autocomplete="one-time-code"
        spellcheck="false"
      /></label
    >
    {#if asksApp}
      <label
        >App code<input
          class="orden-field"
          bind:value={fromApp}
          placeholder="000000"
          aria-label="App code"
          inputmode="numeric"
          autocomplete="one-time-code"
          spellcheck="false"
        /></label
      >
    {/if}
  {/if}
  {#if adding === 'primary'}
    <p class="note">You will sign in with the new address. The old one gets a link to undo it for 7 days.</p>
  {/if}
</EditSheet>

<style>
  .current {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .current .what {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
