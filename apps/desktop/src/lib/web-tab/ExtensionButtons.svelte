<script lang="ts">
  import { scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import Plus from 'lucide/dist/esm/icons/plus.mjs'
  import Puzzle from 'lucide/dist/esm/icons/puzzle.mjs'
  import { t } from '../i18n.svelte'
  import { dur } from '../motion'
  import { extensions, pinnedOf } from './extensions.svelte'

  const {
    addable,
    open,
    onpress,
    onlist,
    onadd,
  }: {
    addable: string | null
    open: string | null
    onpress: (id: string, anchor: HTMLElement) => void
    onlist: (anchor: HTMLElement) => void
    onadd: (anchor: HTMLElement) => void
  } = $props()

  const pinned = $derived(pinnedOf(extensions.list))
</script>

{#each pinned as one (one.id)}
  <button
    class="orden-glyph extension"
    data-extension={one.id}
    class:is-on={open === one.id}
    class:is-wrong={one.problem !== null}
    title={one.problem ? `${one.name}: ${one.problem}` : one.name}
    aria-label={one.name}
    aria-haspopup="dialog"
    onclick={(event) => onpress(one.id, event.currentTarget)}
    transition:scale={{ start: 0.6, duration: dur(160), easing: cubicOut }}
  >
    {#if one.picture}
      <img src={one.picture} alt="" draggable="false" />
    {:else}
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {#each Puzzle as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    {/if}
  </button>
{/each}

{#if addable}
  <button
    class="orden-chip add"
    disabled={extensions.installing !== null}
    title={t('Add extension')}
    onclick={(event) => onadd(event.currentTarget)}
    transition:scale={{ start: 0.6, duration: dur(160), easing: cubicOut }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Plus as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
    {t('Add')}
  </button>
{/if}

<button
  class="orden-glyph"
  data-opens="extensions"
  title={t('Extensions')}
  aria-label={t('Extensions')}
  aria-haspopup="dialog"
  onclick={(event) => onlist(event.currentTarget)}
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#each Puzzle as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
</button>

<style>
  .extension img {
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
  }

  .add {
    gap: var(--space-1);
  }

  .add svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
  }
</style>
