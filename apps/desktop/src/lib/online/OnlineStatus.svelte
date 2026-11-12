<script lang="ts">
  import Sweep from '../Sweep.svelte'
  import { type Status, statusLine } from './arrival.svelte'

  const { status, onretry }: { status: Status; onretry: () => void } = $props()

  const failed = $derived('failed' in status)
  const gone = $derived('gone' in status)
  const held = $derived('held' in status ? status : null)
</script>

<div class="status" class:failed={failed || held !== null} role="status">
  <p>{statusLine(status)}</p>
  {#if held}
    <button type="button" class="orden-button" onclick={onretry}
      >{held.taken ? 'Take back' : 'Take over'}</button
    >
  {:else if failed}
    <button type="button" class="orden-button" onclick={onretry}
      >{gone ? 'New online terminal' : 'Try again'}</button
    >
  {:else}
    <div class="sweep"><Sweep /></div>
  {/if}
</div>

<style>
  .status {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: min(24rem, calc(100% - var(--space-6)));
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    animation: arrive var(--dur-base) var(--ease-out) var(--dur-slow) both;
  }

  .status.failed {
    animation-delay: 0s;
  }

  p {
    margin: 0;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  .failed p {
    color: var(--text-strong);
  }

  .sweep {
    width: 6rem;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      scale: 0.97;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status {
      animation-name: none;
    }
  }
</style>
