<script lang="ts">
  /** The one thing the app says about a microphone that is open: a dot, the time so
   *  far, and a stop.
   *
   *  Its own component rather than a corner of the status bar, because the recorder
   *  behind it is a subsystem - the microphone, the container, the WAV pieces, the
   *  transcript, the summary - and nothing in it is worth a byte before somebody
   *  presses Record. The bar asks for this the moment a recording starts and keeps it
   *  afterwards, so the pill's own way in and out is exactly what it was; see
   *  surfaces.svelte.ts and StatusBar.svelte.
   *
   *  Read off the store rather than handed in: a recording belongs to the window
   *  rather than to any one note, and this is the one place that says so. */

  import { t } from './i18n.svelte'
  import { recorder } from './recorder/recording.svelte'
  import { spanOf } from './recorder/transcript'
</script>

{#if recorder.on || recorder.saving}
  <!-- The bar shape every floating bar in the app wears, so this is one design and
       not a second one; only where it sits and what is in it is here. See
       `.nib-bar` in base.css.

       What went wrong is not said here: that is the line at the top of the document,
       which is already where work that failed and carried on says so. See
       Progress.svelte and busy.svelte.ts. -->
  <div class="nib-bar recording" class:saving={!recorder.on}>
    <span class="dot" class:behind={recorder.retrying || recorder.waiting > 1}></span>
    <span class="clock">{spanOf(recorder.elapsed)}</span>
    <button
      title={t('Stop recording')}
      aria-label={t('Stop recording')}
      disabled={!recorder.on}
      onclick={() => recorder.toggle(recorder.kind)}
    >
      <svg viewBox="0 0 12 12"><rect x="3" y="3" width="6" height="6" rx="1" /></svg>
    </button>
  </div>
{/if}

<style>
  /* The recording pill: the middle of the bottom edge, clear of the numbers in one
     corner, the vim mode in the other and the phone's own plus button.

     Laid out the way the numbers and the mode beside it are - absolute, in the box
     the bar is given - rather than fixed to the window. It looks like the same thing
     and is not: a `fixed` element is positioned inside the nearest ancestor with a
     transform on it, and on a phone that is the layer the drawer slides, so the pill
     would have ridden the drawer sideways and sat on the gesture bar. The drive
     measures where it actually lands. */
  .recording {
    position: absolute;
    z-index: 26;
    left: 50%;
    bottom: calc(var(--space-3) + var(--inset-bottom));
    transform: translateX(-50%);
    align-items: center;
    gap: var(--space-2);
    padding-inline-start: var(--space-3);
    animation: pill-in var(--dur-base) var(--ease-spring);
  }

  /* Up from the edge it is pinned to, which is where a thing that has just started
     comes from. */
  @keyframes pill-in {
    from {
      opacity: 0;
      transform: translate(-50%, var(--space-3));
    }
  }

  /* Stopped, and still writing the file down. The dot has nothing to pulse about any
     more and the clock says how long the recording was. */
  .recording.saving {
    opacity: 0.75;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--danger);
    animation: pill-beat 1.8s var(--ease-in-out) infinite;
  }

  /* A transcript that is behind, or a piece being sent again: the dot holds still and
     goes to the accent. Nothing else changes, because the recording itself is fine and
     a second red thing would read as the recording being in trouble. */
  .dot.behind {
    background: var(--accent);
    animation: none;
  }

  .recording.saving .dot {
    background: var(--muted);
    animation: none;
  }

  @keyframes pill-beat {
    50% {
      opacity: 0.35;
    }
  }

  .clock {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--muted-strong);
  }

  .recording svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: currentColor;
  }

  /* A beat that is not moving is a dot that is simply there, which still says a
     microphone is open. */
  @media (prefers-reduced-motion: reduce) {
    .dot,
    .recording {
      animation: none;
    }
  }
</style>
