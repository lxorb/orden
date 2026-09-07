<script lang="ts">
  /** The canvas's own bar: the four kinds of card, and the six colours.
   *
   *  The format bar's shape, because it is the same kind of thing - a handful of
   *  buttons floating over a surface - and one shape used twice is one shape to
   *  learn. Docked at the bottom of the pane rather than following a selection:
   *  what it does is put something on the plane, which has no selection to follow
   *  until there is. */

  import { DOTS } from './canvas/palette'
  import type { NodeKind } from './canvas/format'
  import { t } from './i18n.svelte'

  const {
    onadd,
    oncolour,
    colouring,
  }: {
    onadd: (kind: NodeKind) => void
    oncolour: (colour: string | null) => void
    /** Whether anything is picked, which is what the dots would colour. */
    colouring: boolean
  } = $props()

  /** A shape each, drawn rather than named: a card, a page, a chain link, a
   *  frame. Four glyphs say what four words would. */
  const KINDS: { kind: NodeKind; title: string; path: string }[] = [
    { kind: 'text', title: t('Card'), path: 'M2 3h10v8H2zM4.5 6h5M4.5 8h3' },
    { kind: 'file', title: t('Note or picture'), path: 'M3.5 2h4l3 3v7h-7zM7.5 2v3h3' },
    {
      kind: 'link',
      title: t('Link'),
      path: 'M5.6 8.4 8.4 5.6M6.6 4 8 2.6a2.8 2.8 0 0 1 4 4L10.6 8M7.4 10 6 11.4a2.8 2.8 0 0 1-4-4L3.4 6',
    },
    { kind: 'group', title: t('Group'), path: 'M2 4h10v8H2zM2 4V2h4v2' },
  ]
</script>

<div class="nib-bar bar">
  {#each KINDS as one (one.kind)}
    <button type="button" title={one.title} aria-label={one.title} onclick={() => onadd(one.kind)}>
      <svg viewBox="0 0 14 14"><path d={one.path} /></svg>
    </button>
  {/each}

  <span class="split"></span>

  {#each DOTS as dot (dot.colour)}
    <button
      type="button"
      class="dot"
      title={t('Colour {number}', { number: dot.colour })}
      aria-label={t('Colour {number}', { number: dot.colour })}
      disabled={!colouring}
      style:--dot={dot.css}
      onclick={() => oncolour(dot.colour)}
    ></button>
  {/each}

  <button
    type="button"
    class="dot none"
    title={t('No colour')}
    aria-label={t('No colour')}
    disabled={!colouring}
    onclick={() => oncolour(null)}
  ></button>
</div>

<style>
  /* Over the plane, at the bottom of the pane and clear of its corners. */
  .bar {
    position: absolute;
    left: 50%;
    bottom: var(--space-4);
    translate: -50% 0;
    z-index: 6;
    align-items: center;
    animation: rise var(--dur-base) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: -50% 8px;
    }
  }

  svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .split {
    width: 1px;
    height: 16px;
    margin: 0 4px;
    background: var(--line-strong);
  }

  /* A colour is a colour: the dot is the whole button, and hovering lifts it
     rather than painting the accent over it. */
  .dot {
    min-width: 0;
    width: 16px;
    height: 16px;
    margin: 0 1px;
    padding: 0;
    border-radius: 50%;
    background: var(--dot);
    transition:
      scale var(--dur-fast) var(--ease-spring),
      opacity var(--dur-fast) var(--ease-out);
  }

  .dot:hover:not(:disabled) {
    background: var(--dot);
    scale: 1.18;
  }

  .dot:active:not(:disabled) {
    background: var(--dot);
    scale: 1.05;
  }

  .dot:disabled {
    opacity: 0.3;
  }

  /* No colour at all, drawn as the ring the others fill. */
  .dot.none {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--muted);
  }

  .dot.none:hover:not(:disabled),
  .dot.none:active:not(:disabled) {
    background: none;
  }
</style>
