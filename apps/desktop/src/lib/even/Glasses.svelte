<script lang="ts">
  /** The region of the note that is on the glasses, marked in the plugin.
   *
   *  A rounded outline in the accent, drawn around exactly the characters the panel
   *  is showing and moving with the page as it turns. It is the one thing the plugin
   *  adds to the editor, and it is what makes the binding legible: without it the
   *  glasses are a second screen showing something; with it they are showing *that*.
   *
   *  Drawn from the editor's own coordinates rather than guessed at from a fraction
   *  of the document. `coordsAtPos` is what CodeMirror uses to put its own cursor
   *  somewhere, so the frame lands on the same pixel the words do whatever the line
   *  heights are.
   *
   *  The other half of the scroll binding lives here too: the scroller says where the
   *  top of the viewport is, `posAtCoords` turns that into a place in the note, and
   *  the glasses go to the page that holds it. */

  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { bridge } from './bridge.svelte'
  import { t } from '../i18n.svelte'
  import { views } from '../views.svelte'
  import { workspace } from '../workspace.svelte'

  /** How long the frame takes to reach the next page. The app's own duration for
   *  something that moves because something else did; see tokens.css. */
  const MOVE = 170

  /** How often the phone's own scroll is turned into a page.
   *
   *  A scroll fires every frame and a page costs radio, so the reader's thumb is
   *  read at a sensible rate rather than at sixty hertz. */
  const SCROLLED = 120

  /** The smallest a frame may be, so that a page of one short line is still a
   *  rectangle rather than a line. */
  const LEAST = 26

  interface Box {
    top: number
    left: number
    width: number
    height: number
    /** True when the frame is only part of the region, because the rest of it has
     *  scrolled off the top or the bottom of the editor. */
    cut: boolean
  }

  let box = $state<Box | null>(null)
  /** True while the frame is moving because the page turned, rather than because
   *  the reader is scrolling. Only then does it ease: a frame that eases its way
   *  down a scroll lags behind the words it is supposed to be around. */
  let moving = $state(false)

  const showing = $derived(bridge.showing)

  /** The editor in the pane that has the focus, if it is showing a note. */
  function editor() {
    const tab = workspace.active
    if (tab?.kind !== 'note') return null

    return views.of(tab.paneId) ?? null
  }

  /** Where the page on the glasses is, in the window's own pixels.
   *
   *  `coordsAtPos` answers null for a position the editor has not drawn - most of a
   *  long note, most of the time - so both ends are asked for and either one is
   *  enough to place the frame. Clamped to the editor, and null when the region has
   *  scrolled out of it altogether: a frame pinned to an edge with no words in it is
   *  worse than no frame. */
  function measure(): Box | null {
    const view = editor()
    const where = showing
    if (!view || !where) return null

    const rect = view.scrollDOM.getBoundingClientRect()
    const length = view.state.doc.length
    const from = view.coordsAtPos(Math.min(where.from, length))
    const to = view.coordsAtPos(Math.max(0, Math.min(where.to, length) - 1))
    if (!from && !to) return null

    const first = from?.top ?? to?.top ?? 0
    const last = to?.bottom ?? from?.bottom ?? 0
    if (last <= rect.top || first >= rect.bottom) return null

    const top = Math.max(first, rect.top)
    const bottom = Math.min(last, rect.bottom)
    return {
      top,
      left: rect.left,
      width: rect.width,
      height: Math.max(LEAST, bottom - top),
      cut: first < rect.top || last > rect.bottom,
    }
  }

  /** The place in the note at the top of the editor's own viewport.
   *
   *  What the glasses are taken to. Not the caret: a reader scrolls to read, and what
   *  they are looking at is the top of the screen rather than wherever they last
   *  typed. */
  function atTop(): number | null {
    const view = editor()
    if (!view) return null

    const rect = view.scrollDOM.getBoundingClientRect()
    return view.posAtCoords({ x: rect.left + 8, y: rect.top + 4 }, false)
  }

  onMount(() => {
    let waiting: ReturnType<typeof setTimeout> | undefined
    let easing: ReturnType<typeof setTimeout> | undefined
    let frame = 0
    let watched: HTMLElement | null = null

    const remeasure = () => {
      cancelAnimationFrame(frame)
      // After the browser has laid out whatever moved: an edit, a page turn, a
      // resize. One frame is enough and two would be a flicker.
      frame = requestAnimationFrame(() => {
        box = measure()
      })
    }

    const scrolled = () => {
      // Following the words rather than easing towards them.
      moving = false
      remeasure()
      clearTimeout(waiting)
      waiting = setTimeout(() => {
        const at = atTop()
        if (at !== null) bridge.scrolled(at)
      }, SCROLLED)
    }

    // The scroller is the editor's own, and a pane rebuilds its editor when it
    // changes note, so it is found again rather than held.
    const follow = () => {
      const found = editor()?.scrollDOM ?? null
      if (found === watched) return

      watched?.removeEventListener('scroll', scrolled)
      watched = found
      found?.addEventListener('scroll', scrolled, { passive: true })
      remeasure()
    }

    const every = setInterval(follow, 250)
    window.addEventListener('resize', remeasure)
    follow()

    // The page turned: ease to it, once, for as long as the app eases anything.
    let was = -1
    const turned = $effect.root(() => {
      $effect(() => {
        const page = showing?.page ?? -1
        if (page !== was) {
          was = page
          moving = true
          clearTimeout(easing)
          easing = setTimeout(() => {
            moving = false
          }, MOVE)
        }

        remeasure()
      })
    })

    return () => {
      turned()
      clearInterval(every)
      clearTimeout(waiting)
      clearTimeout(easing)
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', remeasure)
      watched?.removeEventListener('scroll', scrolled)
    }
  })
</script>

<!-- What the glasses are hearing and saying, on the phone too. Nothing at all
     while the microphone is shut, which is every moment nobody asked for it. -->
{#if bridge.listening || bridge.asked}
  <div class="voice" spellcheck="false" transition:fly={{ y: 12, duration: 170, easing: cubicOut }}>
    {#if bridge.asked}
      <p class="asked">{bridge.asked}</p>
      {#if bridge.answer}
        <p class="answer">{bridge.answer.split('\n')[0]}</p>
      {:else}
        <p class="answer waiting">{t('Thinking')}</p>
      {/if}
    {:else}
      <span class="dot" aria-hidden="true"></span>
      <p class="asked">{t('Listening')}</p>
    {/if}
  </div>
{/if}

{#if box}
  <div
    class="frame"
    class:moving
    class:cut={box.cut}
    aria-hidden="true"
    style:top="{box.top}px"
    style:left="{box.left}px"
    style:width="{box.width}px"
    style:height="{box.height}px"
    style:--move="{MOVE}ms"
  ></div>
{/if}

<style>
  /* The app's own shape: the same radius, the same accent, the same easing as
     anything else that marks a region. Fixed, because the measurement is in the
     window's pixels and a plugin must not have to find a positioned ancestor
     inside somebody else's component. */
  .frame {
    position: fixed;
    z-index: 3;
    box-sizing: border-box;
    border: 1.5px solid var(--accent);
    border-radius: var(--radius-md);
    opacity: 0.5;
    pointer-events: none;
  }

  /* Only while the page is turning. A frame that eases its way down a scroll lags
     behind the words it is meant to be around. */
  .moving {
    transition:
      top var(--move) var(--ease-out),
      height var(--move) var(--ease-out);
  }

  /* What the glasses are hearing, in the corner the app keeps for things it is
     doing rather than things it is asking. One line, because a panel of seven lines
     is no place for a paragraph and neither is this. */
  .voice {
    position: fixed;
    /* Clear of the button the app floats in that corner: two things in one place
       is one of them covering the other. */
    right: calc(var(--space-3) + 60px);
    bottom: var(--space-3);
    left: var(--space-3);
    z-index: 2000;
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    pointer-events: none;
  }

  .asked {
    flex: 1;
    margin: 0;
    overflow: hidden;
    color: var(--text);
    font-size: var(--text-sm);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .answer {
    margin: 0;
    overflow: hidden;
    max-width: 45%;
    color: var(--muted-strong);
    font-size: var(--text-xs);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* The one moving thing on the page, and it stops the moment there is an answer. */
  .waiting,
  .dot {
    animation: waiting 1.4s var(--ease-in-out) infinite;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
  }

  @keyframes waiting {
    0%,
    100% {
      opacity: 0.35;
    }

    50% {
      opacity: 1;
    }
  }

  /* Part of the region is off the screen, so the frame is not the whole of it: the
     edge it was cut at is left open rather than drawn as a boundary that is not
     there. */
  .cut {
    border-radius: 0;
    opacity: 0.35;
  }
</style>
