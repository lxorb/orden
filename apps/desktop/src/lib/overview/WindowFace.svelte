<script lang="ts">
  /** What a window of the overview shows: what its tab would show, drawn the size its
   *  pane is and made small by the window (issue #331).
   *
   *  The tab in front of a pane is the pane itself, copied (mirror.ts). Any other is the
   *  picture kept of it the last time it was on screen, this run or an earlier one
   *  (faces.svelte.ts): a note, a canvas, a shell, a chat, as it was drawn; a web page as
   *  it was last photographed. One never on screen on this device is, for a note, its
   *  words through the reading renderer, the page the export writes; and for anything
   *  else its mark, its name and where it is from. */

  import { readingHtml, unreadableHtml } from '../reading/render'
  import { trustsHtmlIn } from '../sharing.svelte'
  import TabMark from '../TabMark.svelte'
  import { theme } from '../theme.svelte'
  import { pages } from '../web-tab/pages.svelte'
  import type { Tab } from '../workspace.svelte'
  import { drawInto, type Face } from './faces'
  import { scrolledBack } from './mirror'

  const {
    tab,
    mirror,
    face,
    width,
    height,
  }: {
    tab: Tab
    mirror: HTMLElement | null
    /** The picture kept of it, if there is one. */
    face: Face | null
    width: number
    height: number
  } = $props()

  /** As much of a note as a window can show at most: the start of it. A note of a
   *  hundred thousand words is not rendered whole to show its first screen. */
  const START = 6000

  let html = $state('')

  /** The pane's copy, put inside. */
  function holding(node: HTMLElement, copy: HTMLElement) {
    node.append(copy)
  }

  $effect(() => {
    if (mirror || face?.html || tab.kind !== 'note') return
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

  const shot = $derived(tab.kind === 'web' ? (pages.of(tab.id).shot ?? face?.shot ?? null) : null)

  /** A kept picture drawn again, at the size it was taken and made the window's width,
   *  its scrollers where they were. */
  function drawn(node: HTMLElement, kept: Face) {
    const draw = (one: Face) => {
      if (one.html) drawInto(node, one.html)
      requestAnimationFrame(() => scrolledBack(node))
    }
    draw(kept)
    return { update: draw }
  }

  /** Where a tab with no picture is from: a page's site, a file's folder. */
  const whence = $derived.by(() => {
    if (tab.kind === 'web') {
      try {
        return new URL(pages.of(tab.id).url ?? '').host
      } catch {
        return ''
      }
    }
    const path = tab.path ?? ''
    return path.slice(0, path.lastIndexOf('/')).replace(/^\//, '')
  })
</script>

<div class="face" style:width="{width}px" style:height="{height}px">
  {#if mirror}
    <div class="held" use:holding={mirror}></div>
  {:else if face?.html}
    <div
      class="kept"
      style:width="{face.w}px"
      style:height="{face.h}px"
      style:scale={width / Math.max(face.w, 1)}
      use:drawn={face}
    ></div>
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
      {#if whence}<span class="whence">{whence}</span>{/if}
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

  /* A kept picture: the pane as it was, at its own size, made the window's width from
     its top left. */
  .kept {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    overflow: hidden;
  }

  .kept > :global(*) {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
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
    font-size: calc(2.4 * var(--text-base));
  }

  /* The tab's mark, four times the strip's. */
  .big {
    display: flex;
    scale: 4;
    margin-bottom: var(--space-6);
  }

  .whence {
    max-width: 80%;
    overflow: hidden;
    color: var(--faint, var(--muted));
    font-size: calc(1.5 * var(--text-base));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    max-width: 80%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
