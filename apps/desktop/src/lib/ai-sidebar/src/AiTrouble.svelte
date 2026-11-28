<script lang="ts">
  import { Mascot } from '../../mascot/src/api'

  const { onretry }: { onretry?: () => void } = $props()
</script>

<div class="trouble">
  <Mascot mood="unsure" size={32} />
  <p>The AI panel could not open.</p>
  {#if onretry}
    <button class="orden-button is-quiet" onclick={onretry}>Try again</button>
  {/if}
</div>

<style>
  .trouble {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-4);
    text-align: center;
  }
  p {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }
</style>
