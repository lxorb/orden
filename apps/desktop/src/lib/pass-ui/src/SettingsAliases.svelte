<script lang="ts">
  import AtSign from 'lucide/dist/esm/icons/at-sign.mjs'
  import { message } from '../../ui-kit/src/api'
  import { Select } from '../../ui-controls/src/api'
  import type { AliasAccount } from '../../pass-sync/src/api'
  import type { AliasOptions, AliasService } from '../../pass-sync/src/api'
  import { aliasClient } from '../../pass-sync/src/api'
  import Glyph from './Glyph.svelte'
  import { pass } from '../../pass-sync/src/api'

  const NAMES: Record<AliasService, string> = { simplelogin: 'SimpleLogin', addy: 'addy.io' }

  let account = $state.raw<AliasAccount | null>(null)
  let read = $state(false)
  let provider = $state<AliasService>('simplelogin')
  let key = $state('')
  let testing = $state(false)
  let said = $state<string | null>(null)
  let wrong = $state<string | null>(null)
  let options = $state.raw<AliasOptions | null>(null)

  const providers = $derived(
    (Object.keys(NAMES) as AliasService[]).map((one) => ({ value: one, label: NAMES[one] })),
  )

  $effect(() => {
    let current = true
    void pass.aliasProvider().then((kept) => {
      if (!current) return
      account = kept
      read = true
    })
    return () => {
      current = false
    }
  })

  $effect(() => {
    const now = account
    options = null
    if (!now) return
    let current = true
    void aliasClient(now.provider, now.key)
      .options()
      .then((found) => {
        if (current) options = found
      })
      .catch((error: unknown) => {
        if (current) wrong = message(error, 'The alias service could not be reached.')
      })
    return () => {
      current = false
    }
  })

  async function test(): Promise<boolean> {
    testing = true
    said = null
    wrong = null
    try {
      const boxes = await aliasClient(provider, key.trim()).mailboxes()
      said = `Connected. ${String(boxes.length)} mailboxes.`
      return true
    } catch (error) {
      wrong = message(error, 'The alias service could not be reached.')
      return false
    } finally {
      testing = false
    }
  }

  async function connect(event: SubmitEvent) {
    event.preventDefault()
    if (!(await test())) return
    const next: AliasAccount = { provider, key: key.trim(), mailbox: null, suffix: null }
    await pass.setAliasProvider(next)
    account = next
    key = ''
  }

  async function disconnect() {
    await pass.setAliasProvider(null)
    account = null
    said = null
    wrong = null
  }

  async function chose(change: Partial<Pick<AliasAccount, 'mailbox' | 'suffix'>>) {
    if (!account) return
    const next = { ...account, ...change }
    await pass.setAliasProvider(next)
    account = next
  }
</script>

{#if read && account}
  <div class="card">
    <div class="orden-setting row">
      <span class="mark"><Glyph icon={AtSign} /></span>
      <span class="name">{NAMES[account.provider]}</span>
      <button class="orden-chip" type="button" onclick={() => void disconnect()}>Disconnect</button>
    </div>
    {#if options}
      {#if options.mailboxes.length}
        <div class="orden-setting row">
          <span class="name">Default mailbox</span>
          <Select
            label="Default mailbox"
            value={account.mailbox ?? options.mailboxes.find((one) => one.isDefault)?.id ?? ''}
            options={options.mailboxes.map((one) => ({ value: one.id, label: one.email }))}
            onchange={(value: string) => void chose({ mailbox: value })}
          />
        </div>
      {/if}
      {#if options.suffixes.length}
        <div class="orden-setting row">
          <span class="name">Default domain</span>
          <Select
            label="Default domain"
            value={options.suffixes.find((one) => one.label === account?.suffix)?.label ??
              options.suffixes[0]?.label ??
              ''}
            options={options.suffixes.map((one) => ({ value: one.label, label: one.label }))}
            onchange={(value: string) => void chose({ suffix: value })}
          />
        </div>
      {/if}
    {/if}
  </div>
{:else if read}
  <form class="card" onsubmit={(event) => void connect(event)}>
    <div class="orden-setting row">
      <span class="name">Alias service</span>
      <Select
        label="Alias service"
        value={provider}
        options={providers}
        onchange={(value: string) => (provider = value === 'addy' ? 'addy' : 'simplelogin')}
      />
    </div>
    <div class="key">
      <input
        class="orden-field is-value"
        type="password"
        autocomplete="off"
        placeholder="API key"
        aria-label="API key"
        bind:value={key}
      />
      <button
        class="orden-chip"
        type="button"
        disabled={!key.trim() || testing}
        onclick={() => void test()}>Test connection</button
      >
      <button class="orden-button" type="submit" disabled={!key.trim() || testing}>Connect</button>
    </div>
  </form>
  <p class="line">
    Aliases hide your email address: mail sent to an alias is forwarded to your mailbox.
  </p>
{/if}
{#if said}<p class="line" role="status">{said}</p>{/if}
{#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    margin: 0;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card > :global(* + *) {
    border-top: 1px solid var(--line);
  }

  .row {
    padding: var(--space-1) var(--space-3);
  }

  .mark {
    display: grid;
    place-items: center;
    color: var(--muted-strong);
  }

  .key {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .key input {
    flex: 1;
    min-width: 0;
  }

  .line {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }
</style>
