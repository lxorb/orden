<script lang="ts">
  /** The whole surface, while the account's writing is still on its way.
   *
   *  A mark to say whose it is, the line the app already draws for work worth
   *  waiting on, and a count when the pass knows one. Nothing else: there is no
   *  sentence that would tell anybody more than the line already does, and the
   *  one thing they might want - out - only appears once waiting has stopped
   *  looking like it will end.
   *
   *  The state it draws is `arriving`, in arriving.svelte.ts. Named for the pass
   *  rather than for the state because a file called Arriving.svelte would be the
   *  same name as that store on a filesystem that does not mind case, and the
   *  import would quietly resolve to whichever of the two came first. */

  import { fade } from 'svelte/transition'
  import { account } from './account.svelte'
  import { arriving } from './arriving.svelte'
  import { t } from './i18n.svelte'
  import Sweep from './Sweep.svelte'
  import { dur } from './motion'

  /** Whoever is here, in one letter. The name they chose or the front of their
   *  address, which is what everything else in the app calls them. */
  const initial = $derived((account.name ?? '?').trim().charAt(0).toUpperCase())

  /** A count while the pass knows one, and the app's own word for this while it
   *  does not. Never both: two things saying one thing is one too many. */
  const said = $derived(
    arriving.total === null || arriving.total === 0
      ? t('Syncing')
      : t('{done} of {total}', {
          done: Math.min(arriving.done, arriving.total),
          total: arriving.total,
        }),
  )
</script>

{#if arriving.showing}
  <div class="arriving" transition:fade={{ duration: dur(190) }} role="status" aria-live="polite">
    <div class="mark">{initial}</div>

    <!-- The same line the app draws along the top of a document for an export or
         an import; here it is what is being waited on, so it sits under the mark
         rather than at an edge. -->
    <div class="line">
      <Sweep />
    </div>

    <p class="said">{said}</p>

    {#if arriving.stuck}
      <button
        type="button"
        transition:fade={{ duration: dur(130) }}
        onclick={() => arriving.giveUp()}
      >
        {t('Continue')}
      </button>
    {/if}
  </div>
{/if}

<style>
  /* Over the app and under the sheets: a question the app asks still has to be
     answerable, and the prompt sheet sits at 50. */
  .arriving {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    background: var(--bg);
  }

  /* The same square the rail draws a space as, at the size of something the
     whole window is waiting for. */
  .mark {
    display: grid;
    place-items: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: 1.5rem;
    font-weight: 550;
    animation: settle var(--dur-slow) var(--ease-spring) backwards;
  }

  .line {
    width: 8rem;
    border-radius: 1px;
    background: var(--surface-3);
  }

  .said {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  button {
    padding: 7px 13px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  button:hover {
    background: var(--surface-2);
    transform: translateY(-1px);
  }

  button:active {
    background: var(--surface-3);
    transform: translateY(0);
  }

  @keyframes settle {
    from {
      opacity: 0;
      transform: scale(0.92);
    }
  }

  /* The tokens are already zero for everything eased, so the one keyframed thing
     here is all that needs saying; the line says it for itself. */
  @media (prefers-reduced-motion: reduce) {
    .mark {
      animation: none;
    }
  }
</style>
