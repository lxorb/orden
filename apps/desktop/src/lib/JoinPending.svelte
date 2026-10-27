<script lang="ts">
  /** A join sheet put aside, said at the foot of the window until it is answered:
   *  the pulse and the line the sheet had, and a press opens the sheet again with
   *  its Cancel. Slack's pending invitation and Google Docs' "request sent", which
   *  both stay where the reader can find them rather than in a modal.
   *
   *  The recording pill's shape, in the same middle track; see RecordingPill.svelte
   *  and `.notices` in App.svelte. Fetched only while something is put aside; see
   *  surfaces.svelte.ts. */
  import { joining } from './joining.svelte'
  import { t } from './i18n.svelte'

  const who = $derived(joining.invitation?.from ?? t('Somebody'))
  const said = $derived(
    joining.step === 'waiting'
      ? t('Waiting for {who}', { who })
      : t('{who} shared {space} with you', {
          who,
          space: joining.invitation?.note ?? joining.invitation?.space ?? '',
        }),
  )
</script>

{#if joining.aside}
  <button type="button" class="nib-bar pending" onclick={() => joining.reopen()}>
    {#if joining.step === 'waiting'}<span class="pulse"></span>{/if}
    {said}
  </button>
{/if}

<style>
  .pending {
    grid-column: 2;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--row-height);
    padding-inline: var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
    cursor: default;
    animation: pill-in var(--dur-base) var(--ease-spring);
  }

  :global([data-touch]) .pending {
    grid-column: 1;
    justify-self: center;
  }

  @keyframes pill-in {
    from {
      opacity: 0;
      transform: translateY(var(--space-3));
    }
  }

  /* The sheet's own dot; see JoinSheet.svelte. */
  .pulse {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 50%;
    background: var(--accent);
    animation: breathe 1.8s var(--ease-out) infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pending,
    .pulse {
      animation: none;
    }
  }
</style>
