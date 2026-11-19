<script lang="ts">
  import { localNumber } from '../../platform/src/api'

  const { count, most = 99, corner = false }: { count: number; most?: number; corner?: boolean } = $props()
</script>

{#if count > 0}
  <span class="count" class:corner>{count > most ? `${localNumber(most)}+` : localNumber(count)}</span>
{/if}

<style>
  .count {
    --tall: 18px;
    min-width: var(--tall);
    padding: 0 5px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--accent-ink);
    font: var(--weight-strong) var(--text-xs) / var(--tall) var(--font-ui);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .corner {
    --tall: 13px;
    position: absolute;
    top: 1px;
    inset-inline-end: 1px;
    padding: 0 3px;
    font-size: 9px;
  }
</style>
