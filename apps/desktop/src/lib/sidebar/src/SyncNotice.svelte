<script lang="ts">
  import { account } from '../../accounts/src/api'
  import { leftBy } from '../../left-spaces/src/api'
  import { sync } from '../../sync-store/src/api'
  import { workspace } from '../../workspace/src/api'

  const SETTLES = 2000
  const root = $derived(workspace.activeSpace?.root ?? null)
  const paired = $derived(root !== null && (account.signedIn ? sync.remoteIdFor(root) !== null : leftBy(root) !== null))
  const why = $derived.by(() => {
    if (!paired) return null
    if (!account.signedIn) return 'Not syncing. This is what this device last saw.'
    if (sync.status === 'error') return `Not syncing: ${sync.lastError ?? 'sync stopped'}.`
    if (sync.status === 'off') return 'Not syncing. Sync is off on this device.'
    return null
  })
  let said = $state<string | null>(null)
  $effect(() => {
    const now = why
    if (now === null) {
      said = null
      return
    }
    const timer = setTimeout(() => (said = now), SETTLES)
    return () => clearTimeout(timer)
  })
</script>

{#if said}
  <p class="notice" role="status">
    <span>{said}</span>
    {#if !account.signedIn}
      <button class="orden-chip" onclick={() => (account.open = true)}>Sign in</button>
    {/if}
  </p>
{/if}

<style>
  .notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    margin: 0 0 var(--space-2);
    padding: var(--space-2) var(--row-pad);
    border-radius: var(--radius-row);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }
</style>
