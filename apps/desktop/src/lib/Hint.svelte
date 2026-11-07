<script lang="ts">
  import Help from 'lucide/dist/esm/icons/circle-question-mark.mjs'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { hang } from './portal'
  import { dur } from './motion'

  const { text }: { text: string } = $props()

  let open = $state(false)
  let host = $state<HTMLElement>()

  function outside(event: PointerEvent) {
    if (open && host && !host.contains(event.target as Node)) open = false
  }
</script>

<svelte:window onpointerdown={outside} />

<span class="explain orden-mark orden-hint" bind:this={host}
  >&#8288;<button
    type="button"
    aria-label={text}
    onclick={(event) => {
      event.stopPropagation()
      open = !open
    }}
    onpointerenter={() => (open = true)}
    onpointerleave={(event) => {
      if (event.pointerType === 'mouse') open = false
    }}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    onkeydown={(event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation()
        open = false
      }
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Help as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  {#if open}
    <span
      class="orden-bubble sentence"
      aria-hidden="true"
      use:hang={{ side: 'below', gap: 6, inset: -3 }}
      transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}>{text}</span
    >
  {/if}
</span>

<style>
  .explain {
    position: relative;
  }

  :global(:has(> .orden-hint)) {
    --mark-gap: 5px;
    --mark-size: 16px;
  }

  :global([data-touch] :has(> .orden-hint)) {
    --mark-size: var(--touch-icon);
  }

  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  button:hover {
    color: var(--text-strong);
  }

  button:focus-visible {
    outline-offset: 1px;
  }

  svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sentence {
    position: fixed;
    z-index: var(--z-bubble);
  }

  :global([data-touch]) button::after {
    content: '';
    position: absolute;
    inset: calc((var(--touch-icon) - var(--touch-target)) / 2);
  }

  :global([data-touch]) svg {
    width: var(--touch-mark);
    height: var(--touch-mark);
  }
</style>
