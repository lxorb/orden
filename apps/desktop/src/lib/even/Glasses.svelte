<script lang="ts">
  /** Where the reader is on the glasses, in the corner of the plugin.
   *
   *  Two numbers, a pair of lenses and a dot. Nothing else belongs here: the note
   *  is on the glasses, the editor is on the phone, and this answers the two
   *  questions the phone cannot - which page they are looking at, and whether the
   *  glasses are hearing us at all. Absent entirely until a phone app answers, so
   *  a browser sees nothing.
   *
   *  The dot is also the only way anything is ever learned about a launch that
   *  went wrong on a device, where there is no console to open: pressing the
   *  corner shows what happened, in few enough words to photograph. */

  import { bridge } from './bridge.svelte'
  import { t } from '../i18n.svelte'

  const showing = $derived(bridge.showing)
  const where = $derived(showing ? `${showing.page + 1}/${showing.count}` : '')
  /** Nothing at all in a browser: no phone app, nothing to say about glasses. */
  const here = $derived(bridge.health !== 'alone')

  let open = $state(false)

  const said = $derived(
    bridge.health === 'live'
      ? t('Page {page} of {count} on the glasses', {
          page: (showing?.page ?? 0) + 1,
          count: showing?.count ?? 0,
        })
      : bridge.health === 'reaching'
        ? t('Reaching the glasses')
        : t('The glasses are not keeping up'),
  )
</script>

{#if here}
  <div class="corner">
    {#if open && bridge.trail.length}
      <!-- What happened, newest last. Untranslated on purpose: these are the
           platform's own words, and a translated one is a word nobody can look
           up. -->
      <ol class="trail">
        {#each bridge.trail as line, at (at)}
          <li>{line}</li>
        {/each}
      </ol>
    {/if}

    <button
      class="glasses"
      class:stalled={bridge.stalled}
      type="button"
      aria-label={said}
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6.5" cy="14" r="4" />
        <circle cx="17.5" cy="14" r="4" />
        <path d="M10.5 14h3M2.5 12 4 8h4M21.5 12 20 8h-4" />
      </svg>
      <span class="dot" class:beating={bridge.health === 'reaching'} data-health={bridge.health}
      ></span>
      {#if where}<span class="where">{where}</span>{/if}
    </button>
  </div>
{/if}

<style>
  /* Above the document and out of the way of the format bar, which sits on the
     other side. */
  .corner {
    position: fixed;
    right: var(--space-3);
    bottom: var(--space-3);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-end;
  }

  .glasses {
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
    transition:
      opacity var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out);
  }

  .glasses:active {
    opacity: 0.7;
  }

  /* The one thing it has to say when something is wrong: it has stopped keeping
     up. Dimmed rather than worded. */
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

  /* Which state, as a colour and a movement rather than a sentence. */
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted);
    transition: background var(--dur-base) var(--ease-out);
  }

  .dot[data-health='live'] {
    background: var(--accent);
  }

  .dot[data-health='stalled'],
  .dot[data-health='failed'] {
    background: var(--danger);
  }

  /* Still looking for the phone app. The only motion in the corner, and it stops
     the moment there is an answer either way. */
  .beating {
    animation: beat 1.4s var(--ease-in-out) infinite;
  }

  @keyframes beat {
    0%,
    100% {
      opacity: 0.35;
    }

    50% {
      opacity: 1;
    }
  }

  .where {
    font-variant-numeric: tabular-nums;
  }

  .trail {
    max-width: min(19rem, 70vw);
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    list-style: none;
    overflow-wrap: anywhere;
  }
</style>
