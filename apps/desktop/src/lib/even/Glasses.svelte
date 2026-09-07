<script lang="ts">
  /** Where the reader is on the glasses, in the corner of the plugin.
   *
   *  Two numbers, a pair of lenses and a dot. Nothing else belongs here: the note
   *  is on the glasses, the editor is on the phone, and this answers the two
   *  questions the phone cannot - which page they are looking at, and whether the
   *  glasses are hearing us at all.
   *
   *  Always there in the plugin, even with no phone app behind the page, because
   *  a corner that hides when things go wrong hides exactly when it is wanted:
   *  it was gated on having found a bridge, and on a device that found none it
   *  was the missing evidence rather than the evidence. Pressing it says what the
   *  plugin knows about itself. */

  import { bridge } from './bridge.svelte'
  import { diagnosis } from './diagnosis.svelte'
  import { t } from '../i18n.svelte'

  const showing = $derived(bridge.showing)
  const where = $derived(showing ? `${showing.page + 1}/${showing.count}` : '')

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

<div class="corner">
  {#if diagnosis.open}
    <!-- Untranslated on purpose: these are the platform's own words and the
         page's own numbers, and a translated one is a word nobody can look up. -->
    <dl class="facts">
      {#each diagnosis.facts as fact (fact.name)}
        <dt>{fact.name}</dt>
        <dd>{fact.value}</dd>
      {/each}
      {#each bridge.trail as line, at (at)}
        <dt>·</dt>
        <dd>{line}</dd>
      {/each}
    </dl>
  {/if}

  <button
    class="glasses"
    class:stalled={bridge.stalled}
    type="button"
    aria-label={said}
    aria-expanded={diagnosis.open}
    onclick={() => diagnosis.toggle()}
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

<style>
  /* Above the document and out of the way of the format bar, which sits on the
     other side. The z-index is deliberately far above the app's own: this is the
     one surface that has to be visible when the rest has gone wrong. */
  .corner {
    position: fixed;
    right: var(--space-3);
    bottom: var(--space-3);
    left: var(--space-3);
    z-index: 2000;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-end;
    pointer-events: none;
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
    pointer-events: auto;
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
  .dot[data-health='failed'],
  .dot[data-health='alone'] {
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

  /* A debug view, so the values are what matter: every one on its own line, in
     the mono face, wrapping rather than cut, and scrollable when there are more
     than a screen of them. */
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0 var(--space-2);
    width: 100%;
    max-height: 70vh;
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.5;
    pointer-events: auto;
  }

  dt {
    color: var(--muted);
    white-space: nowrap;
  }

  dd {
    margin: 0;
    color: var(--text);
    overflow-wrap: anywhere;
  }
</style>
