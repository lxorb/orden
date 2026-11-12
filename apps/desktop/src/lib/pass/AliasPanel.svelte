<script lang="ts">
  import type { Alias, Item } from '@orden/pass/types'
  import { atLeast } from '@orden/pass/types'
  import { message } from '../message'
  import { aliasStats, switchedAlias } from './alias-live'
  import type { AliasStats } from './aliases'
  import { pass } from './store.svelte'
  import SwitchRow from './SwitchRow.svelte'

  const { item, content }: { item: Item; content: Alias } = $props()

  let stats = $state.raw<AliasStats | null>(null)
  let busy = $state(false)
  let wrong = $state<string | null>(null)

  const role = $derived(pass.vaults.find((one) => one.id === item.vault)?.role ?? 'viewer')
  const editable = $derived(item.trashed === null && atLeast(role, 'editor'))

  $effect(() => {
    const remote = content.remoteId
    stats = null
    if (remote === '' || content.provider === 'manual') return
    let current = true
    void aliasStats(content)
      .then((found) => {
        if (current) stats = found
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  })

  async function switched(on: boolean) {
    busy = true
    wrong = null
    try {
      await switchedAlias(item.id, content, on)
    } catch (error) {
      wrong = message(error, 'The alias service could not be reached.')
    } finally {
      busy = false
    }
  }
</script>

<section class="card" aria-label="Alias">
  <SwitchRow
    label="Forward mail to this alias"
    on={content.enabled}
    disabled={!editable || busy}
    onchange={(on: boolean) => void switched(on)}
  />
  {#each content.mailboxes as mailbox (mailbox)}
    <div class="line">
      <span class="label">Forwards to</span>
      <span class="value">{mailbox}</span>
    </div>
  {/each}
  {#if stats}
    <div class="stats" data-alias-stats>
      <span class="when"
        >{stats.days === null ? 'All time' : `Last ${String(stats.days)} days`}</span
      >
      <span><strong>{stats.forwarded}</strong> forwarded</span>
      <span><strong>{stats.replied}</strong> replied</span>
      <span><strong>{stats.blocked}</strong> blocked</span>
    </div>
  {/if}
  {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
</section>

<style>
  .card {
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card > :global(* + *) {
    border-top: 1px solid var(--line);
  }

  .line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-row);
  }

  .label,
  .when {
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .label {
    flex: 1;
  }

  .value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }

  .stats strong {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .wrong {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    color: var(--danger);
  }
</style>
