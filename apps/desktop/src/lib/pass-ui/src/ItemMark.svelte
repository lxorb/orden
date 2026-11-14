<script lang="ts">
  import type { Content } from '@orden/pass/types'
  import Icon from '../../Icon.svelte'
  import { readIcon } from '../../ui-kit/src/api'
  import { webPages } from '@orden/contracts'
  import Glyph from './Glyph.svelte'
  import { KIND_ICONS } from '../../pass-sync/src/api'

  const { content, big = false }: { content: Content; big?: boolean } = $props()

  const site = $derived(
    content.kind === 'login'
      ? (content.websites.map((one) => webPages().faviconOf(one.url)).find((one) => one !== null) ??
          null)
      : null,
  )
  let broken = $state(false)
</script>

<span class="item-mark" class:is-big={big} data-kind={content.kind} aria-hidden="true">
  {#if site && !broken}
    <img src={site} alt="" draggable="false" onerror={() => (broken = true)} />
  {:else if content.kind === 'custom' && content.mark}
    <Icon icon={readIcon(content.mark)} fallback={KIND_ICONS.custom} />
  {:else}
    <Glyph icon={KIND_ICONS[content.kind]} />
  {/if}
</span>

<style>
  .item-mark {
    --tile: 32px;
    --tile-ink: var(--accent);

    flex: none;
    display: grid;
    place-items: center;
    width: var(--tile);
    height: var(--tile);
    border-radius: calc(var(--tile) * var(--radius-third));
    background: color-mix(in srgb, var(--tile-ink) 16%, transparent);
    color: var(--tile-ink);
  }

  .item-mark.is-big {
    --tile: 44px;
  }

  .item-mark.is-big :global(.glyph) {
    width: var(--icon-lg);
    height: var(--icon-lg);
  }

  .item-mark[data-kind='alias'] {
    --tile-ink: var(--canvas-4);
  }

  .item-mark[data-kind='card'] {
    --tile-ink: var(--canvas-2);
  }

  .item-mark[data-kind='note'] {
    --tile-ink: var(--canvas-3);
  }

  .item-mark[data-kind='identity'] {
    --tile-ink: var(--canvas-5);
  }

  .item-mark:is([data-kind='custom'], [data-kind='ssh'], [data-kind='wifi']) {
    --tile-ink: var(--canvas-1);
  }

  .item-mark img {
    width: 60%;
    height: 60%;
    object-fit: contain;
  }

  :global([data-touch]) .item-mark {
    --tile: 44px;
  }
</style>
