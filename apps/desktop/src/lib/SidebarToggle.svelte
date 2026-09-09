<script lang="ts">
  /** The one button that opens and shuts the file list.
   *
   *  It lives at the left end of the title bar, where every desktop app puts it,
   *  and in the drawer's own head on a phone and a tablet - where a drawer over the
   *  note covers the bar the button usually sits in, so the drawer needs the same
   *  button to shut itself with. One component because it is one control: the same
   *  glyph, the same words, the same movement, whichever of the two it is drawn
   *  in.
   *
   *  The glyph says what pressing it does. Shut, it is a plain window; open, the
   *  panel's edge stands a little way inside it, and it slides out from the left
   *  as the list arrives and back into the edge as it goes. */
  import { t } from './i18n.svelte'
  import { workspace } from './workspace.svelte'

  const open = $derived(!!workspace.panel)
  const label = $derived(open ? t('Hide sidebar') : t('Show sidebar'))
</script>

<button
  class="toggle"
  class:on={open}
  title={label}
  aria-label={label}
  aria-pressed={open}
  onclick={() => workspace.toggleSidebar()}
>
  <svg viewBox="0 0 14 14">
    <rect x="1" y="2.5" width="12" height="9" rx="1.5" />
    <path class="edge" d="M5.5 2.5v9" />
  </svg>
</button>

<style>
  .toggle {
    width: 38px;
    flex: none;
    display: grid;
    place-items: center;
    border: none;
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  /* Only where there is a pointer to hover with. A touch browser pretends the
     last finger is still hovering, which left this lit after every swipe from
     the corner it sits in. */
  @media (hover: hover) {
    .toggle:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  /* Answered under the finger, not when the sidebar has finished moving. */
  .toggle:active {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  .toggle.on {
    color: var(--accent);
  }

  .toggle svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.2;
  }

  /* The panel's edge, which arrives from the left as the list does and leaves
     the same way. The same curve and the same length as the drawer's own. */
  .edge {
    transition:
      transform var(--dur-base) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .toggle:not(.on) .edge {
    transform: translateX(-4.5px);
    opacity: 0;
  }

  .toggle:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  /* A thumb's target rather than a pointer's, and the glyph drawn at the size
     every other icon on a touch screen is. */
  :global([data-touch]) .toggle {
    width: var(--touch-row);
    height: var(--touch-row);
  }
</style>
