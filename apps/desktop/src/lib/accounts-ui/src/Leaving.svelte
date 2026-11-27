<script lang="ts">
  import { account } from '../../accounts/src/api'
  import { leavingDay, leavingNow } from './leaving'

  const pending = $derived(account.user || account.staying ? null : leavingNow())
</script>

{#if pending}
  <p class="leaving" role="status">
    <strong>{pending.email}</strong> will be deleted on {leavingDay(pending.on)}. Signing in before then, on any device,
    cancels the deletion.
  </p>
{/if}

<style>
  .leaving {
    margin: var(--space-2) 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }
  .leaving strong {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }
</style>
