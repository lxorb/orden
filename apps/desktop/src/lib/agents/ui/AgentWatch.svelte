<script lang="ts">
  import { Sheet } from '../../ui-controls/src/api'
  import type { Activity } from './activity.svelte'
  import { hostOf } from './session'
  import { LOOK_EVERY, Watching } from './watching.svelte'

  const { activity, tab, onclose }: { activity: Activity; tab: string; onclose: () => void } =
    $props()

  const watching = new Watching(() => activity.peek(tab))

  const held = $derived(activity.seen.tabs[tab])
  const touched = $derived(activity.seen.acting[tab]?.at ?? 0)
  const title = $derived(held ? held.title || hostOf(held.url) : '')

  $effect(() => {
    if (!held) onclose()
  })

  const seen = $derived([touched, held?.url, held?.title, held?.parked].join('\n'))

  $effect(() => {
    if (seen) void watching.look()
  })

  $effect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void watching.look()
    }, LOOK_EVERY)
    return () => clearInterval(timer)
  })

  function takeOver() {
    void activity.show(tab)
    onclose()
  }
</script>

<Sheet open={!!held} {title} width="min(1120px, 94vw)" {onclose}>
  <div class="watch">
    <span class="address" dir="ltr">{held?.url ?? ''}</span>
    {#if held?.parked}
      <p class="quiet">Asleep</p>
    {:else if watching.picture}
      <img
        class="page"
        class:stale={watching.failed}
        src={`data:image/png;base64,${watching.picture.png}`}
        width={watching.picture.width}
        height={watching.picture.height}
        alt={title}
        draggable="false"
      />
    {:else}
      <p class="quiet">Loading…</p>
    {/if}
  </div>
  {#snippet foot()}
    <button class="orden-chip" onclick={takeOver}>Take over</button>
  {/snippet}
</Sheet>

<style>
  .watch {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .address {
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page {
    display: block;
    width: auto;
    max-width: 100%;
    height: auto;
    max-height: calc(100dvh - 15rem);
    margin-inline: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }

  .stale {
    opacity: 0.6;
  }

  .quiet {
    margin: 0;
    padding: var(--space-4) 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }
</style>
