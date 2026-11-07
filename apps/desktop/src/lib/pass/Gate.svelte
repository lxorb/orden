<script lang="ts">
  import type { IconNode } from 'lucide'
  import type { Snippet } from 'svelte'
  import { fade } from 'svelte/transition'
  import { dur } from '../motion'
  import Glyph from './Glyph.svelte'

  const {
    icon,
    title,
    line = '',
    children,
  }: { icon: IconNode; title: string; line?: string; children: Snippet } = $props()
</script>

<div class="gate" in:fade={{ duration: dur(160) }}>
  <div class="card">
    <span class="mark"><Glyph {icon} /></span>
    <h2 class="title">{title}</h2>
    {#if line}<p class="line">{line}</p>{/if}
    {@render children()}
  </div>
</div>

<style>
  .gate {
    height: 100%;
    display: grid;
    place-items: center;
    padding: var(--space-5) var(--space-4);
    overflow-y: auto;
  }

  .card {
    width: min(100%, 22rem);
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-3);
    text-align: center;
  }

  .mark {
    align-self: center;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    margin-bottom: var(--space-2);
    border-radius: calc(56px * var(--radius-third));
    background: var(--accent-soft);
    color: var(--accent);
  }

  .mark :global(.glyph) {
    width: 26px;
    height: 26px;
  }

  .title {
    margin: 0;
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .line {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    line-height: 1.45;
    color: var(--muted-strong);
  }

  .card :global(form) {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .card :global(.wrong) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .card :global(.nib-action) {
    width: auto;
    align-self: center;
  }

  .card :global(.shake) {
    animation: shake var(--dur-slow) var(--ease-out);
  }

  @keyframes shake {
    0%,
    100% {
      translate: 0;
    }
    20%,
    60% {
      translate: -6px;
    }
    40%,
    80% {
      translate: 6px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card :global(.shake) {
      animation: none;
    }
  }
</style>
