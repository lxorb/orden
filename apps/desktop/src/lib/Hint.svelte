<script lang="ts">
  /** A small `i` after a label, and the sentence behind it.
   *
   *  For the settings whose name only means something to somebody who already
   *  knows the word - Strict CommonMark, smart punctuation - where the honest
   *  answer is a sentence and the pane has no room for one. So the sentence is
   *  there to be asked for: a pointer over the glyph shows it, a thumb taps it,
   *  and the keyboard reaches it like anything else.
   *
   *  Not a `title`. The browser's own tooltip arrives after a second of holding
   *  still, in the system's font, at the pointer rather than at the glyph, and a
   *  finger never sees it at all - which is three ways of not being the app.
   *
   *  The glyph's own name is the sentence, so a screen reader reads it on focus
   *  and the bubble is decoration by the time it appears. */

  import Info from 'lucide/dist/esm/icons/info.mjs'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { dur } from './motion'

  const { text }: { text: string } = $props()

  let open = $state(false)
  let host = $state<HTMLElement>()

  /** A tap anywhere else puts it away, the way a menu closes. */
  function outside(event: PointerEvent) {
    if (open && host && !host.contains(event.target as Node)) open = false
  }
</script>

<svelte:window onpointerdown={outside} />

<span class="explain" bind:this={host}>
  <button
    type="button"
    aria-label={text}
    onclick={(event) => {
      // The row behind this is a control of its own; asking what a setting means
      // is not asking to change it.
      event.stopPropagation()
      open = !open
    }}
    onpointerenter={() => (open = true)}
    onpointerleave={(event) => {
      // A finger reports itself as a pointer entering and never leaving, so only
      // a real hover puts it away again; a tap is the click above.
      if (event.pointerType === 'mouse') open = false
    }}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    onkeydown={(event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation()
        open = false
      }
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Info as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  {#if open}
    <span
      class="sentence"
      aria-hidden="true"
      transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}>{text}</span
    >
  {/if}
</span>

<style>
  .explain {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  /* The glyph itself: quiet enough to be passed over by somebody who knows the
     word, and in the same slot after every label that has one, so a label
     without one sits exactly where it did. */
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
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
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* The sentence, under the glyph. Left-aligned to the glyph rather than
     centred on it: a label sits at the left of its row, so there is room that
     way and none the other. */
  .sentence {
    position: absolute;
    top: calc(100% + 6px);
    left: -8px;
    z-index: 6;
    width: max-content;
    max-width: 16rem;
    padding: 7px 10px;
    background: var(--surface-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 400;
    line-height: 1.45;
    white-space: normal;
    text-align: left;
    pointer-events: none;
  }

  /* A thumb needs a target, and the sentence needs the width the screen has.
     Not a whole finger's row: this sits inside one beside the words it belongs
     to, and a 48px circle in the middle of a label would be the label's size. */
  :global([data-touch]) button {
    width: 26px;
    height: 26px;
  }

  :global([data-touch]) svg {
    width: var(--touch-mark);
    height: var(--touch-mark);
  }

  :global([data-touch]) .sentence {
    max-width: min(20rem, 70vw);
    font-size: var(--text-sm);
  }
</style>
