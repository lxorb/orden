<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import { cubicOut } from 'svelte/easing'
  import ChevronDown from 'lucide/dist/esm/icons/chevron-down.mjs'
  import { MARKS } from './file-mark'
  import Icon from './Icon.svelte'
  import { dur, fly } from './motion'
  import type { NewKindRow } from './new-kinds'

  const {
    one,
    letter,
    rise,
    ...rest
  }: {
    one: NewKindRow
    letter?: string
    rise?: number
  } & HTMLButtonAttributes = $props()
</script>

<button
  type="button"
  class="kind"
  {...rest}
  in:fly={{
    y: 10,
    duration: dur(rise === undefined ? 0 : 150),
    delay: dur((rise ?? 0) * 40),
    easing: cubicOut,
  }}
>
  <span class="mark" aria-hidden="true"
    ><Icon icon={null} fallback={one.icon ?? MARKS[one.mark]} /></span
  >
  <span class="orden-row-label">{one.label()}</span>
  {#if letter}
    <kbd aria-hidden="true">{letter.toUpperCase()}</kbd>
  {/if}
  {#if one.others}
    <span class="more" data-more aria-hidden="true"
      ><span class="chevron"><Icon icon={null} fallback={ChevronDown} /></span></span
    >
  {/if}
</button>

<style>
  .kind {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    width: 9rem;
    max-width: 100%;
    padding: var(--space-5) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    font-weight: var(--weight-row);
    line-height: var(--leading-row);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .kind .orden-row-label {
    flex: initial;
    max-width: 100%;
  }

  @media (hover: hover) {
    .kind:hover {
      background: var(--surface-hover);
      border-color: var(--line-strong);
      color: var(--text-strong);
    }
  }

  .kind:active {
    background: var(--surface-press);
  }

  .mark {
    display: block;
    flex: none;
    width: calc(2 * var(--icon-md));
    height: calc(2 * var(--icon-md));
    font-size: calc(2 * var(--icon-md));
    color: var(--muted);
    stroke: currentColor;
    stroke-width: 1.6;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .kind:hover .mark {
      color: var(--accent);
    }
  }

  .kind:focus-visible .mark {
    color: var(--accent);
  }

  kbd {
    position: absolute;
    top: var(--space-3);
    inset-inline-end: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
    color: var(--muted);
  }

  @media (hover: hover) {
    .kind:hover kbd {
      color: var(--muted-strong);
    }
  }

  .kind:focus-visible kbd {
    color: var(--muted-strong);
  }

  .more {
    --target: calc(var(--icon-sm) + var(--space-2));
    position: absolute;
    bottom: calc(var(--space-3) + (1em - var(--target)) / 2);
    inset-inline-end: calc(var(--space-3) + (1ch - var(--target)) / 2);
    display: grid;
    place-items: center;
    width: var(--target);
    height: var(--target);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    stroke: currentColor;
    stroke-width: 2.2;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .chevron {
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
    transition: translate var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .more:hover {
      color: var(--accent);
    }

    .kind:hover:has(.more:hover) .mark {
      color: var(--muted);
    }
  }

  .more:active .chevron {
    translate: 0 1px;
  }

  .kind:active:has(.more:active) {
    background: var(--surface-hover);
  }

  :global([data-touch]) .kind {
    flex-direction: row;
    justify-content: flex-start;
    width: min(20rem, 100%);
    min-height: var(--touch-row);
    padding: 0 var(--touch-pad);
    gap: var(--touch-gap);
    font-size: var(--touch-text);
    text-align: start;
  }

  :global([data-touch]) .mark {
    width: var(--touch-icon);
    height: var(--touch-icon);
    font-size: var(--touch-icon);
  }

  :global([data-touch]) kbd {
    display: none;
  }

  :global([data-touch]) .more {
    position: static;
    margin-inline-start: auto;
    width: var(--touch-target);
    height: var(--touch-target);
  }
</style>
