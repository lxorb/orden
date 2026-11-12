<script lang="ts">
  import {
    IDENTITY_FIELDS,
    type Identity,
    type IdentityGroup,
    type IdentityKey,
  } from '@orden/pass/types'
  import EditCard from './EditCard.svelte'
  import EditField from './EditField.svelte'
  import { IDENTITY_FIRST } from './field-words'
  import { HIDDEN_IDENTITY, identityFieldName, identityGroupName } from './identity-words'
  import SectionsEdit from './SectionsEdit.svelte'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let { content = $bindable(), oninput }: { content: Identity; oninput: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  const GROUPS = Object.keys(IDENTITY_FIELDS) as IdentityGroup[]

  const opened = $state<Partial<Record<IdentityGroup, boolean>>>({})

  function shownIn(group: IdentityGroup): readonly IdentityKey[] {
    const first = IDENTITY_FIRST[group]
    return IDENTITY_FIELDS[group].filter(
      (key) => opened[group] === true || first.includes(key) || (content.values[key] ?? '') !== '',
    )
  }
</script>

{#each GROUPS as group (group)}
  {@const shown = shownIn(group)}
  <EditCard title={identityGroupName(group)}>
    {#each shown as key (key)}
      <EditField
        label={identityFieldName(key)}
        bind:value={() => content.values[key] ?? '', (next: string) => (content.values[key] = next)}
        kind={HIDDEN_IDENTITY.has(key) ? 'hidden' : key === 'birthdate' ? 'date' : 'text'}
        {oninput}
      />
    {/each}
    {#if shown.length < IDENTITY_FIELDS[group].length}
      <button type="button" class="more" onclick={() => (opened[group] = true)}> Add more </button>
    {/if}
  </EditCard>
{/each}

<SectionsEdit bind:sections={content.sections} {oninput} />

<style>
  .more {
    min-height: var(--row-height);
    padding: var(--space-2) var(--space-3);
    border: none;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    text-align: start;
    cursor: default;
  }
</style>
