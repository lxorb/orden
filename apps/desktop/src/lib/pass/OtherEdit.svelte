<script lang="ts">
  import {
    type Custom,
    type SshKey,
    type Wifi,
    WIFI_SECURITY,
    type WifiSecurity,
  } from '@orden/pass/types'
  import { canMakeSshKey, newSshKey, sshPublicOf } from '@orden/pass/ssh'
  import { message } from '../message'
  import Select from '../Select.svelte'
  import EditCard from './EditCard.svelte'
  import EditField from './EditField.svelte'
  import { FIELD_ICONS } from './field-icons'
  import { securityLabel } from './field-words'
  import PasswordField from './PasswordField.svelte'
  import SectionsEdit from './SectionsEdit.svelte'
  import type { PassUi } from './ui.svelte'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let {
    ui,
    content = $bindable(),
    oninput,
  }: { ui: PassUi; content: Custom | SshKey | Wifi; oninput: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  const securities = $derived(
    WIFI_SECURITY.map((security) => ({ value: security, label: securityLabel(security) })),
  )

  let canGenerate = $state(false)
  let generating = $state(false)
  let wrong = $state<string | null>(null)

  $effect(() => {
    if (content.kind !== 'ssh') return
    let current = true
    void canMakeSshKey().then((can) => {
      if (current) canGenerate = can
    })
    return () => {
      current = false
    }
  })

  async function generate() {
    if (content.kind !== 'ssh') return
    generating = true
    wrong = null
    try {
      const made = await newSshKey(content.title.trim().replace(/\s+/g, '-'))
      content.privateKey = made.privateKey
      content.publicKey = made.publicKey
      oninput()
    } catch (error) {
      wrong = message(error, 'A key could not be made here.')
    } finally {
      generating = false
    }
  }

  function filledPublic() {
    if (content.kind !== 'ssh' || content.publicKey.trim() !== '') return
    const derived = sshPublicOf(content.privateKey)
    if (derived) content.publicKey = derived
  }

  function securityIn(value: string): WifiSecurity {
    return WIFI_SECURITY.find((one) => one === value) ?? 'wpa2'
  }
</script>

{#if content.kind === 'ssh'}
  <EditCard>
    <EditField
      label="Private key"
      icon={FIELD_ICONS.privateKey}
      bind:value={content.privateKey}
      kind="multiline"
      mono
      oninput={() => {
        filledPublic()
        oninput()
      }}
    />
    <EditField
      label="Public key"
      icon={FIELD_ICONS.publicKey}
      bind:value={content.publicKey}
      kind="multiline"
      mono
      {oninput}
    />
  </EditCard>
  {#if canGenerate}
    <button
      class="orden-button is-quiet is-soft generate"
      type="button"
      aria-busy={generating}
      disabled={generating}
      onclick={() => void generate()}
    >
      {content.privateKey.trim() === '' ? 'Generate key' : 'Generate a new key'}
    </button>
  {/if}
  {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
{:else if content.kind === 'wifi'}
  <EditCard>
    <EditField
      label="Network name"
      icon={FIELD_ICONS.network}
      bind:value={content.ssid}
      {oninput}
    />
    <PasswordField {ui} label="Password" bind:value={content.password} onchange={oninput} />
    <div class="security orden-edit-row">
      <span class="label">Security</span>
      <Select
        plain
        value={content.security}
        options={securities}
        onchange={(value: string) => {
          content.security = securityIn(value)
          oninput()
        }}
      />
    </div>
  </EditCard>
{/if}

<SectionsEdit bind:sections={content.sections} {oninput} />

<style>
  .generate {
    align-self: flex-start;
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .security {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }

  .label {
    flex: 1;
    padding-inline-start: calc(var(--icon-md) + var(--space-2));
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .security > :global(:last-child) {
    flex: none;
    width: 10rem;
    max-width: 50%;
  }
</style>
