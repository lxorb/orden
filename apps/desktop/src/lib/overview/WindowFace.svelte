<script lang="ts">
  /** What a window of the overview shows: what its tab would show, drawn the size its
   *  pane is and made small by the window (issue #331).
   *
   *  The tab in front of a pane is the pane itself, copied (mirror.ts). A note behind it
   *  is its words through the reading renderer, the page the export writes. A web tab is
   *  its page as it was last photographed, which is the still a pane holds while its
   *  page is out of sight. Anything else - a canvas, a shell, a chat - wears its mark
   *  and its name, until it has a face of its own. */

  import { readingHtml, unreadableHtml } from '../reading/render'
  import { trustsHtmlIn } from '../sharing.svelte'
  import TabMark from '../TabMark.svelte'
  import { theme } from '../theme.svelte'
  import { pages } from '../web-tab/pages.svelte'
  import type { Tab } from '../workspace.svelte'

  const {
    tab,
    mirror,
    width,
    height,
  }: { tab: Tab; mirror: HTMLElement | null; width: number; height: number } = $props()

  /** As much of a note as a window can show at most: the start of it. A note of a
   *  hundred thousand words is not rendered whole to show its first screen. */
  const START = 6000

  let html = $state('')

  /** The pane's copy, put inside. */
  function holding(node: HTMLElement, copy: HTMLElement) {
    node.append(copy)
  }

  $effect(() => {
    if (mirror || tab.kind !== 'note') return
    const text = tab.doc.slice(0, START)
    const note = { text, path: tab.path }
    let stale = false
    void readingHtml(note, theme.current, trustsHtmlIn(tab.note))
      .catch(() => unreadableHtml(text))
      .then((made) => {
        if (!stale) html = made
      })
    return () => {
      stale = true
    }
  })

  const shot = $derived(tab.kind === 'web' ? pages.of(tab.id).shot : null)
</script>

<div class="face" style:width="{width}px" style:height="{height}px">
  {#if mirror}
    <div class="held" use:holding={mirror}></div>
  {:else if tab.kind === 'note'}
    <div class="read">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, rendered by the same renderer the reading view uses, under the same trust -->
      <article class="page nib-write">{@html html}</article>
    </div>
  {:else if shot}
    <img class="shot" src={shot} alt="" draggable="false" />
  {:else}
    <div class="mark">
      <span class="big"><TabMark {tab} /></span>
      <span class="name">{tab.shown}</span>
    </div>
  {/if}
</div>

<style>
  .face {
    position: relative;
    overflow: hidden;
    background: var(--bg);
    pointer-events: none;
  }

  .held,
  .held > :global(*) {
    width: 100%;
    height: 100%;
  }

  .held > :global(*) {
    display: flex;
    flex-direction: column;
  }

  /* The reading view's column, at the pane's own size. */
  .read {
    height: 100%;
    overflow: hidden;
    padding-top: var(--space-6);
  }

  .shot {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top;
  }

  .mark {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    height: 100%;
    color: var(--muted);
    font-size: calc(2 * var(--text-lg));
  }

  /* The tab's mark, four times the strip's. */
  .big {
    display: flex;
    scale: 4;
    margin-bottom: var(--space-6);
  }

  .name {
    max-width: 80%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
