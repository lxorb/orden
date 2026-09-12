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
   *  One glyph, always: a panel with an edge in it. The edge slides out from the
   *  frame's left side as the list arrives and back into it as the list goes, and
   *  that movement is the whole of what says which state it is in.
   *
   *  It used to fade the edge away as well, and that turned one glyph into two: a
   *  plain window when the list was shut, a split panel when it was open. A button
   *  that redraws itself is a button you have to read twice, and there was nothing
   *  for the eye to follow between the two readings. Now the shape is constant and
   *  only the edge moves, which is the same thing the panel itself does. */
  import { t } from './i18n.svelte'
  import { workspace } from './workspace.svelte'

  const open = $derived(!!workspace.panel)
  const label = $derived(open ? t('Hide sidebar') : t('Show sidebar'))
</script>

<button
  class="nib-glyph toggle"
  class:is-on={open}
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
  /* The button itself is `.nib-glyph` in the themes package: the square every
     icon button in the app is, the row's corner, the row's own hover and press,
     and a mark that a browser's own button padding cannot squash. This used to
     be a hard-coded 38px wide with no height and no corner at all, so it
     stretched to the whole bar and lit a sharp-edged block where the three bars
     beside it lit a rounded one. What is left here is only its own edge. */
  .toggle {
    align-self: center;
  }

  .toggle svg {
    stroke-width: 1.2;
  }

  /* The panel's edge, which arrives from the left as the list does and leaves the
     same way. The same curve and the same length as the drawer's own. Transform
     only: it is always drawn, and where it is is what says whether the list is
     out. Shut, it rests against the frame's left side. */
  .edge {
    transition: transform var(--dur-base) var(--ease-out);
  }

  .toggle:not(.on) .edge {
    transform: translateX(-3.6px);
  }
</style>
