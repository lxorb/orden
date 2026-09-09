<script lang="ts">
  /** The box a space's sheets are drawn in.
   *
   *  Sharing a space and publishing one are the same gesture from the same menu
   *  and ask the same kind of question, so they are the same sheet: it rises in
   *  the middle of a window and from the bottom of a phone, it is dismissed by
   *  the scrim, by Escape and by back, and the rows, cards and buttons inside it
   *  are one set of shapes rather than two that drift.
   *
   *  What is here is the box and those shapes. What each sheet is about is its
   *  own component; see ShareSheet.svelte and PublishSheet.svelte. */
  import type { Snippet } from 'svelte'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { closeOnBack } from './backstack.svelte'
  import { overlays } from './overlays'
  import { dur } from './motion'
  import { trap } from './trap'

  const {
    open,
    title,
    onclose,
    children,
  }: {
    open: boolean
    /** What the sheet is about, which is its heading and what it is read out as. */
    title: string
    onclose: () => void
    children: Snippet
  } = $props()

  // Escape closes it, like everything else the app puts over a note.
  $effect(() => (open ? overlays.show(onclose) : undefined))
  $effect(() => closeOnBack(open, onclose))
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: dur(130) }} onclick={onclose}></div>

  <div
    class="sheet"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={title}
    transition:scale={{ duration: dur(190), start: 0.97, easing: cubicOut }}
  >
    <p class="title">{title}</p>
    {@render children()}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 50;
  }

  .sheet {
    position: fixed;
    top: 14vh;
    left: 50%;
    translate: -50% 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: min(27rem, calc(100vw - 3rem));
    max-height: 72vh;
    overflow-y: auto;
    z-index: 51;
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  .title {
    margin: 0 0 var(--space-2);
    font-size: var(--text-base);
    font-weight: 550;
    color: var(--text-strong);
  }

  /* ── The shapes inside ───────────────────────────────────────────
     Written for whatever the sheet puts in itself, which is why they are
     global: one card, one row, one field and one button, so two sheets cannot
     disagree about what a sheet looks like. */

  /* What went wrong, above whatever asked for it. */
  .sheet :global(.wrong) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .sheet :global(h3) {
    margin: var(--space-3) 0 var(--space-1);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* A run of rows. */
  .sheet :global(.card) {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  /* A column of things that are not rows: a field and what it says about
     itself. */
  .sheet :global(.stack) {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 100%;
  }

  /* What it is on the left, what may be done about it on the right, one line
     each: the same row the settings draw. */
  .sheet :global(.row) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: 38px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  .sheet :global(.name) {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sheet :global(.name small) {
    font-size: var(--text-xs);
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A line under a card or a field, in the one colour it is worth saying in. */
  .sheet :global(.hint) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .sheet :global(.hint.ok) {
    color: var(--success);
  }

  .sheet :global(.hint.bad) {
    color: var(--danger);
  }

  /* A sentence of its own, which may carry a link. */
  .sheet :global(.note) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    line-height: 1.6;
  }

  .sheet :global(.note a) {
    color: var(--accent);
  }

  /* Something typed in: an address, a name, a domain. */
  .sheet :global(input.field) {
    flex: 1;
    width: 100%;
    min-width: 0;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .sheet :global(input.field:focus) {
    border-color: var(--accent);
  }

  /* An action in a card: full width, quiet until pointed at. */
  .sheet :global(.action) {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 34px;
    padding: 6px 0;
    border: none;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    text-align: left;
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .sheet :global(.action:hover:not(:disabled)) {
      color: var(--text-strong);
    }

    .sheet :global(.action.danger:hover:not(:disabled)) {
      color: var(--danger);
    }
  }

  /* A small action at the end of a row, where the control would be. */
  .sheet :global(.pill) {
    flex: none;
    padding: 5px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 99px;
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .sheet :global(.pill.quiet) {
    border-color: transparent;
    color: var(--muted);
  }

  @media (hover: hover) {
    .sheet :global(.pill:hover) {
      border-color: var(--accent);
      color: var(--accent);
    }

    .sheet :global(.pill.quiet:hover) {
      border-color: transparent;
      color: var(--text-strong);
    }
  }

  .sheet :global(.pill:active) {
    background: var(--accent-soft);
  }

  /* The one thing the sheet is for, once it can be done. Where it sits in the
     row or the column holding it is that sheet's business. */
  .sheet :global(.primary) {
    flex: none;
    padding: 8px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .sheet :global(.primary:hover:not(:disabled)) {
    background: var(--accent-hover);
  }

  .sheet :global(.primary:active:not(:disabled)) {
    background: var(--accent-press);
  }

  .sheet :global(.primary:disabled),
  .sheet :global(.action:disabled) {
    opacity: 0.5;
  }

  /* A phone's sheet is the bottom of the screen, and everything in it is the
     size a thumb needs. */
  :global([data-touch]) .sheet {
    top: auto;
    bottom: 0;
    left: 0;
    translate: none;
    width: 100%;
    max-height: 88dvh;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    padding-bottom: calc(var(--space-4) + var(--inset-bottom));
  }

  :global([data-touch]) .sheet :global(.row) {
    min-height: var(--touch-target);
  }

  :global([data-touch]) .sheet :global(.action) {
    min-height: var(--touch-row);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .sheet :global(input.field) {
    min-height: var(--touch-target);
    padding: 0 var(--touch-gap);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .sheet :global(.primary) {
    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .sheet :global(.hint),
  :global([data-touch]) .sheet :global(.note) {
    font-size: var(--text-base);
  }
</style>
