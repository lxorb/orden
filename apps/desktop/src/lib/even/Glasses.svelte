<script lang="ts">
  /** Where the reader is on the glasses, in the corner of the plugin.
   *
   *  Two numbers and a pair of lenses. Nothing else belongs here: the note is
   *  on the glasses, the editor is on the phone, and this only answers the one
   *  question the phone cannot - which page they are looking at. Absent
   *  entirely until a pair answers, so a browser sees nothing at all. */

  import { bridge } from './bridge.svelte'
  import { t } from '../i18n.svelte'

  const showing = $derived(bridge.showing)
  const where = $derived(showing ? `${showing.page + 1}/${showing.count}` : '')
</script>

{#if showing}
  <div
    class="glasses"
    class:stalled={bridge.stalled}
    role="status"
    aria-label={t('Page {page} of {count} on the glasses', {
      page: showing.page + 1,
      count: showing.count,
    })}
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6.5" cy="14" r="4" />
      <circle cx="17.5" cy="14" r="4" />
      <path d="M10.5 14h3M2.5 12 4 8h4M21.5 12 20 8h-4" />
    </svg>
    <span>{where}</span>
  </div>
{/if}

<style>
  /* Above the document and out of the way of the format bar, which sits on the
     other side. Not a button: there is nothing to press, because the glasses
     are steered from the glasses. */
  .glasses {
    position: fixed;
    right: var(--space-3);
    bottom: var(--space-3);
    z-index: 20;
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
    transition:
      opacity var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }

  /* The one thing it has to say when something is wrong: it has stopped
     keeping up. Dimmed rather than worded. */
  .stalled {
    opacity: 0.45;
  }

  svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentcolor;
    stroke-width: 1.6;
    stroke-linecap: round;
  }
</style>
