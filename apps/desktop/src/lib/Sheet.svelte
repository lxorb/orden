<script lang="ts">
  import type { Snippet } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { overlays } from './overlays'
  import { scrollbar } from './scrollbar'
  import { fade, LAYER, scale } from './motion'
  import { trap } from './trap'
  import Cross from './Cross.svelte'

  const {
    open,
    title,
    mark,
    foot,
    width,
    onclose,
    children,
  }: {
    open: boolean
    title: string
    mark?: Snippet
    foot?: Snippet
    width?: string
    onclose: () => void
    children: Snippet
  } = $props()

  $effect(() => (open ? overlays.show(onclose) : undefined))
  $effect(() => closeOnBack(open, onclose))
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="orden-scrim scrim" transition:fade={{ duration: LAYER.fade }} onclick={onclose}></div>

  <div
    class="orden-screen sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={title}
    style:--screen-width={width}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    <div class="head">
      {#if mark}
        <span class="orden-badge" aria-hidden="true">{@render mark()}</span>
      {/if}
      <h2 class="title">{title}</h2>
      <button class="orden-glyph shut" aria-label={t('Close')} title={t('Close')} onclick={onclose}>
        <Cross />
      </button>
    </div>

    <div class="body" data-scrolls use:scrollbar>
      {@render children()}
    </div>

    {#if foot}
      <div class="foot">{@render foot()}</div>
    {/if}
  </div>
{/if}

<style>
  .sheet {
    --screen-width: var(--screen-sheet);

    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: var(--z-sheet);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
  }

  .title {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    overflow-y: auto;
    padding: 0 var(--space-2) var(--space-3);
  }

  .foot {
    flex: none;
    display: flex;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    border-top: 1px solid var(--line);
  }

  .sheet :global(.wrong) {
    margin: 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .sheet :global(h3) {
    margin: 0;
    padding: 0 var(--space-2);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .sheet :global(.card) {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .sheet :global(.card h3) {
    padding: var(--space-2) 0 var(--space-1);
  }

  .sheet :global(.card-head) {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .sheet :global(.line) {
    width: auto;
    height: 1px;
    margin: var(--space-1) calc(-1 * var(--space-2));
    border: none;
    background: var(--line);
  }

  .sheet :global(.stack) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  .sheet :global(.row) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    min-height: 34px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .sheet :global(.name) {
    flex: 1;
    min-width: 0;
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet :global(.name > *) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sheet :global(.name > small) {
    display: block;
    margin-top: 1px;
  }

  .sheet :global(.name small) {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .sheet :global(.hint) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .sheet :global(.hint.ok) {
    color: var(--success);
  }

  .sheet :global(.hint.bad) {
    color: var(--danger);
  }

  .sheet :global(.note) {
    margin: 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
  }

  .sheet :global(.note a) {
    color: var(--accent);
  }

  .sheet :global(input.field) {
    flex: 1;
    width: 100%;
    min-width: 0;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .sheet :global(input.field:focus) {
    border-color: var(--accent);
  }

  :global([data-touch]) .sheet {
    top: auto;
    bottom: var(--keyboard);
    left: 0;
    translate: none;
    width: 100%;
    max-height: min(88dvh, calc(100dvh - var(--keyboard) - var(--inset-top)));
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  :global([data-touch]) .body {
    padding-bottom: var(--touch-bottom);
  }

  :global([data-touch]) .shut {
    margin-inline-end: calc(-1 * var(--space-2));
  }

  :global([data-touch]) .sheet :global(.row) {
    min-height: var(--touch-target);
  }

  :global([data-touch]) .sheet :global(input.field) {
    min-height: var(--touch-target);
    padding: 0 var(--touch-gap);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .sheet :global(.hint),
  :global([data-touch]) .sheet :global(.note) {
    font-size: var(--text-base);
  }
</style>
