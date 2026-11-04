<script lang="ts">
  /** What a window of the overview shows: what its tab would show, drawn the size its
   *  pane is and made small by the window (issue #331).
   *
   *  The tab in front of a pane is the pane itself, under the window (Overview.svelte),
   *  and has none of this. Any other is drawn the way its kind says (`preview` in
   *  workspace/tab-kinds.ts): a note from its words as they are now, through the reading
   *  renderer, from the line it was left at; a terminal from the last of its screen as
   *  written down (previews.ts); a web page from its last photograph; anything else from
   *  the picture kept of it the last time it was on screen (faces.svelte.ts). With
   *  nothing to draw from, it is its mark, its name and where it is from. */

  import { readingHtml, unreadableHtml } from '../reading/render'
  import { trustsHtmlIn } from '../sharing.svelte'
  import TabMark from '../TabMark.svelte'
  import { theme } from '../theme.svelte'
  import { pages } from '../web-tab/pages.svelte'
  import type { Tab } from '../workspace.svelte'
  import { TAB_KINDS } from '../workspace/tab-kinds'
  import { drawInto, type Face } from './faces'
  import { scrolledBack } from './mirror'
  import { readingFrom, scrollbackOf } from './previews'

  const {
    tab,
    face,
    width,
    height,
  }: {
    tab: Tab
    /** The picture kept of it, if there is one. */
    face: Face | null
    width: number
    height: number
  } = $props()

  /** How its kind is drawn while it is not in front. */
  const how = $derived(TAB_KINDS[tab.kind].preview)

  /** As much of a note as a window can show at most: a screenful from where it was left.
   *  A note of a hundred thousand words is not rendered whole to show one screen. */
  const START = 6000

  let html = $state('')

  $effect(() => {
    if (how !== 'reading') return
    const text = readingFrom(tab.doc, tab.anchor, START)
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

  const shot = $derived(how === 'photograph' ? (pages.of(tab.id).shot ?? face?.shot ?? null) : null)

  /** A terminal's last lines, as written down. */
  let screen = $state<{ text: string; cols: number } | null>(null)
  $effect(() => {
    if (how !== 'scrollback') return
    let stale = false
    void scrollbackOf(tab).then((one) => {
      if (!stale) screen = one
    })
    return () => {
      stale = true
    }
  })

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
  {#if how === 'reading'}
    <div class="read">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, rendered by the same renderer the reading view uses, under the same trust -->
      <article class="page nib-write">{@html html}</article>
    </div>
  {:else if how === 'scrollback' && screen}
    <pre class="screen">{screen.text}</pre>
  {:else if how === 'photograph' && shot}
    <img class="shot" src={shot} alt="" draggable="false" />
  {:else if face?.html}
    <div
      class="kept"
      style:width="{face.w}px"
      style:height="{face.h}px"
      style:scale={width / Math.max(face.w, 1)}
      use:drawn={face}
    ></div>
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

  /* A terminal's last lines, in the terminal's own face, from the bottom up as a screen
     fills. */
  .screen {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    height: 100%;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-row);
    line-height: 1.35;
    white-space: pre;
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
