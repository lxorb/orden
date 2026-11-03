<script lang="ts">
  /** A small `?` after a label, and the sentence behind it.
   *
   *  For the settings whose name only means something to somebody who already
   *  knows the word - Strict CommonMark, smart punctuation - where the honest
   *  answer is a sentence and the pane has no room for one. So the sentence is
   *  there to be asked for: a pointer over the glyph shows it, a thumb taps it,
   *  and the keyboard reaches it like anything else.
   *
   *  Not a `title`, and not a bubble of its own: the card the sentence appears in
   *  is `.nib-bubble` in the themes package, which the name being renamed on a row
   *  shows its reason in too. What is here is where this one sits.
   *
   *  The glyph's own name is the sentence, so a screen reader reads it on focus
   *  and the bubble is decoration by the time it appears. */

  import Help from 'lucide/dist/esm/icons/circle-question-mark.mjs'
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

<!-- A word joiner first, so no line ever breaks between the label's last word and
     the glyph: the `?` wraps with that word instead of standing on a line alone. -->
<span class="explain nib-hint" bind:this={host}
  >&#8288;<button
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
      // The keys that press this button press only this button: a row that is a
      // switch as a whole would otherwise hear them too and turn its setting over,
      // as it would a click (#522).
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
    }}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each Help as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
  </button>

  {#if open}
    <span
      class="nib-bubble sentence"
      aria-hidden="true"
      transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}>{text}</span
    >
  {/if}
</span>

<style>
  /* In the label's own line, as a word of it, rather than a box beside the label
     (#1052). A row that set the label and the glyph side by side in a flex row
     centred the glyph on the label's line box - the font's ascent, descent and
     leading - which is not where the letters are, and is somewhere else again in
     every face, size and platform; and on a name that wrapped, it centred the glyph
     on all of its lines at once and left a gap after the last word as wide as the
     longest line. Here the glyph is centred the way CSS centres a thing on letters,
     `vertical-align: middle`, on the middle of the label's own x-height; it follows
     the last word on that word's line; and the gap before it is `--hint-gap` in
     every label and in either direction.

     And it takes no room of its own on the line: the glyph is pulled back over its
     own width and drawn where it would have stood, and the label keeps the gap and
     the glyph free at its end instead (below). A word joiner keeps the glyph with
     the last word only while the two fit on a line together; a word as wide as the
     name - German has them - is broken by `overflow-wrap: anywhere`, and the glyph
     would be broken off with it onto a line by itself. */
  .explain {
    position: relative;
    white-space: nowrap;
  }

  /* The gap and the glyph, said on the label the glyph follows, which keeps that
     much room free at its end - room inside the label's own width - and hands both
     down to the glyph. */
  :global(:has(> .nib-hint)) {
    --hint-gap: 5px;
    --hint-glyph: 16px;
    padding-inline-end: calc(var(--hint-gap) + var(--hint-glyph));
  }

  :global([data-touch] :has(> .nib-hint)) {
    --hint-glyph: var(--touch-icon);
  }

  /* The glyph itself: quiet enough to be passed over by somebody who knows the
     word, and in the same slot after every label that has one, so a label
     without one sits exactly where it did. */
  button {
    position: relative;
    inset-inline-start: calc(var(--hint-glyph, 16px) + var(--hint-gap, 5px));
    display: inline-flex;
    vertical-align: middle;
    align-items: center;
    justify-content: center;
    width: var(--hint-glyph, 16px);
    height: var(--hint-glyph, 16px);
    margin: 0;
    margin-inline-start: calc(-1 * var(--hint-glyph, 16px));
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
    outline-offset: 1px;
  }

  /* A mark inside a row rather than in front of a name: `--icon-sm`, which is
     what every other such mark in the app is. It was 14px. */
  svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* Where this one sits: under the glyph, and left-aligned to it rather than
     centred on it, because a label sits at the left of its row, so there is room
     that way and none the other. The card itself is `.nib-bubble`. */
  .sentence {
    position: absolute;
    top: calc(100% + 6px);
    inset-inline-start: calc(var(--hint-gap, 5px) - 8px);
    z-index: var(--z-popover);
  }

  /* A thumb needs a target, and the sentence needs the width the screen has.
     Not a whole finger's row: this sits inside one beside the words it belongs
     to, and a 48px circle in the middle of a label would be the label's size.

     So the glyph grows to Android's 24dp and the *target* grows to the 48 a
     finger needs, invisibly, around it: what is drawn and what can be hit are
     two different sizes, which is how a small control is aimed at without being
     drawn big. It used to be a 26px box - a number of its own, under the floor,
     and the only thing a finger had to land on. */
  :global([data-touch]) button::after {
    content: '';
    position: absolute;
    inset: calc((var(--touch-icon) - var(--touch-target)) / 2);
  }

  :global([data-touch]) svg {
    width: var(--touch-mark);
    height: var(--touch-mark);
  }
</style>
