<script lang="ts">
  import type { Alias } from '@orden/pass/types'
  import { message } from '../ui-kit/src/api'
  import { Select } from '../ui-controls/src/api'
  import { defaultAsk } from './alias-make'
  import type { AliasAsk, AliasOptions } from './aliases'
  import EditCard from './EditCard.svelte'
  import EditField from './EditField.svelte'
  import { FIELD_ICONS } from './field-icons'
  import { aliasOptions } from './new-alias'
  import SwitchRow from './SwitchRow.svelte'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let {
    content = $bindable(),
    fresh = false,
    oninput,
    onask,
  }: {
    content: Alias
    fresh?: boolean
    oninput: () => void
    onask: (ask: AliasAsk | null) => void
  } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  let options = $state.raw<AliasOptions | null>(null)
  let looking = $state(false)
  let wrong = $state<string | null>(null)
  let prefix = $state('')
  let suffix = $state('')
  let mailbox = $state('')

  $effect(() => {
    if (!fresh) return
    let current = true
    looking = true
    void aliasOptions()
      .then((found) => {
        if (!current || !found) return
        options = found.options
        const first = defaultAsk(found.account, found.options, found.options.prefix)
        prefix = first.prefix
        suffix = first.suffix
        mailbox = first.mailboxes[0] ?? ''
      })
      .catch((error: unknown) => {
        if (current) wrong = message(error, 'The alias service could not be reached.')
      })
      .finally(() => {
        if (current) looking = false
      })
    return () => {
      current = false
    }
  })

  const cleanPrefix = $derived(
    prefix
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, ''),
  )

  $effect(() => {
    onask(
      options && cleanPrefix !== '' && suffix !== ''
        ? {
            prefix: cleanPrefix,
            suffix,
            mailboxes: mailbox ? [mailbox] : [],
            name: '',
            note: '',
          }
        : null,
    )
  })

  const suffixes = $derived(
    (options?.suffixes ?? []).map((one) => ({
      value: one.value,
      label: one.premium ? `${one.label} ★` : one.label,
    })),
  )
  const mailboxes = $derived(
    (options?.mailboxes ?? []).map((one) => ({ value: one.id, label: one.email })),
  )
  const suffixLabel = $derived(options?.suffixes.find((one) => one.value === suffix)?.label ?? '')
</script>

{#if fresh && options}
  <EditCard>
    <EditField label="Prefix" bind:value={prefix} placeholder="shop" {oninput} />
    <div class="choose orden-edit-row">
      <span class="label">Suffix</span>
      <Select
        plain
        label="Suffix"
        value={suffix}
        options={suffixes}
        onchange={(value: string) => {
          suffix = value
          oninput()
        }}
      />
    </div>
    {#if mailboxes.length}
      <div class="choose orden-edit-row">
        <span class="label">Forwards to</span>
        <Select
          plain
          label="Forwards to"
          value={mailbox}
          options={mailboxes}
          onchange={(value: string) => {
            mailbox = value
            oninput()
          }}
        />
      </div>
    {/if}
    <p class="preview" data-alias-preview>{cleanPrefix}{suffixLabel}</p>
  </EditCard>
  <EditCard>
    <EditField label="Display name" bind:value={content.name} {oninput} />
  </EditCard>
{:else}
  {#if fresh}
    <p class="hint" role={wrong ? 'alert' : null}>
      {wrong ??
        (looking
          ? 'Asking the alias service…'
          : 'Connect an alias service in Settings > Aliases to make new addresses here.')}
    </p>
  {/if}
  <EditCard>
    <EditField
      label="Alias address"
      icon={FIELD_ICONS.alias}
      bind:value={content.address}
      inputmode="email"
      placeholder="name@example.com"
      {oninput}
    />
    <EditField label="Display name" bind:value={content.name} {oninput} />
    {#if content.provider === 'manual'}
      <SwitchRow
        label="Forward mail to this alias"
        on={content.enabled}
        onchange={(on: boolean) => {
          content.enabled = on
          oninput()
        }}
      />
    {/if}
  </EditCard>
{/if}

<style>
  .choose {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }

  .label {
    flex: 1;
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .choose > :global(:last-child) {
    flex: none;
    width: 14rem;
    max-width: 60%;
  }

  .preview {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-strong);
    overflow-wrap: anywhere;
  }

  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>
