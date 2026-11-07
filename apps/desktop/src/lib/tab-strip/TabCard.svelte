<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fade, fly } from '../motion'
  import SpaceMark from '../SpaceMark.svelte'
  import type { Shown } from './hover-card.svelte'

  const {
    hovering,
  }: { hovering: { readonly card: Shown | null; readonly facts: readonly string[] } } = $props()

  const card = $derived(hovering.card)
</script>

{#if card}
  <div
    class="orden-bubble card"
    class:sliding={card.sliding}
    style:translate="{card.x}px {card.y}px"
    aria-hidden="true"
    in:fly={{ y: -4, duration: dur(150), easing: cubicOut }}
    out:fade={{ duration: dur(120) }}
  >
    {#key card.id}
      <div class="words" in:fade={{ duration: dur(120) }}>
        <strong class="name"><bdi>{card.title}</bdi></strong>
        {#if card.where || card.from}
          <span class="where">
            {#if card.where}<span class="site">{card.where}</span>{/if}
            {#if card.from}
              <span class="from">
                <span class="orden-badge mark"><SpaceMark {...card.from} /></span>
                <span class="site">{card.from.name}</span>
              </span>
            {/if}
          </span>
        {/if}
        {#each hovering.facts as fact (fact)}
          <span class="fact">{fact}</span>
        {/each}
      </div>
    {/key}
    {#if card.still}
      <img class="still" src={card.still} alt="" draggable="false" />
    {/if}
  </div>
{/if}

<style>
  .card {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-popover);
    width: 16rem;
    overflow: hidden;
  }

  .card.sliding {
    transition: translate var(--dur-base) var(--ease-out);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
    color: var(--text-strong);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    unicode-bidi: isolate;
  }

  .where {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    color: var(--muted);
    white-space: nowrap;
  }

  .fact {
    color: var(--muted);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .site {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    unicode-bidi: isolate;
  }

  .from {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    max-width: 50%;
  }

  .mark {
    --row-height-sm: var(--icon-md);
    font-size: var(--text-xs);
  }

  .still {
    display: block;
    width: calc(100% + 2 * var(--space-3));
    aspect-ratio: 16 / 9;
    margin: var(--space-2) calc(-1 * var(--space-3)) calc(-1 * var(--space-2));
    object-fit: cover;
    object-position: top;
    border-top: 1px solid var(--line-strong);
  }
</style>
