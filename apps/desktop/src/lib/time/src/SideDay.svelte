<script lang="ts">
  import { MINUTE, ticking } from './days'
  import ActivityLayer from './ActivityLayer.svelte'
  import Chip from './Chip.svelte'
  import { edited } from './edit'
  import { clock, length } from './look'
  import type { Minute } from './minutes'
  import { daysOf } from './rows'
  import { placeBlock, setActivity } from './schedule'
  import { time } from './time.svelte'

  const {
    from,
    to,
    now,
    minutes,
    onmanage,
  }: { from: number; to: number; now: number; minutes: readonly Minute[]; onmanage: () => void } = $props()
  interface Asking {
    anchor: HTMLElement
    chosen: string | null
    pick: (activity: string) => void
  }
  const rows = $derived(
    (daysOf(time.spans, minutes, from, to, now, true)[0]?.rows ?? []).filter(
      (row) => row.kind === 'block' || (row.kind === 'unset' && row.to - row.from >= MINUTE),
    ),
  )
  let asking = $state<Asking | null>(null)
  function ask(anchor: EventTarget | null, chosen: string | null, pick: (activity: string) => void) {
    if (!(anchor instanceof HTMLElement)) return
    asking = asking?.anchor === anchor ? null : { anchor, chosen, pick }
  }
  function change(id: string, anchor: EventTarget | null) {
    ask(anchor, time.span(id)?.activity ?? null, (activity) =>
      edited(setActivity(time.spans, id, activity), 'scheduled'),
    )
  }
  function fill(anchor: EventTarget | null, start: number, end: number) {
    ask(anchor, null, (activity) =>
      edited(placeBlock(time.spans, start, end, activity, now, crypto.randomUUID()), 'scheduled'),
    )
  }
</script>

<div class="day" data-time-side-day>
  {#if !rows.length}
    <p class="empty">Nothing tracked today</p>
  {/if}
  {#each rows as row (`${row.kind}-${row.from}-${row.kind === 'block' ? row.span.id : ''}`)}
    <div class="line">
      <span class="clock">{clock(row.from)}</span>
      {#if row.kind === 'block'}
        {@const running = row.span.end === null}
        <div class="block" class:running data-time-side-block={row.span.id}>
          <Chip
            activity={row.span.activity}
            onclick={(event: MouseEvent) => change(row.span.id, event.currentTarget)}
          />
          <span class="long">{running ? ticking(now - row.from) : length(row.to - row.from)}</span>
        </div>
      {:else if row.kind === 'unset'}
        <div class="block unset" data-time-side-unset>
          <button
            type="button"
            class="orden-chip choose"
            onclick={(event) => fill(event.currentTarget, row.from, row.to)}>Choose activity</button
          >
          <span class="long">{length(row.to - row.from)}</span>
        </div>
      {/if}
    </div>
  {/each}
</div>
{#if asking}
  <ActivityLayer
    from={asking.anchor}
    chosen={asking.chosen}
    onpick={asking.pick}
    {onmanage}
    onclose={() => (asking = null)}
  />
{/if}

<style>
  .day {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .empty {
    margin: var(--space-2) var(--space-1);
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .line {
    display: grid;
    grid-template-columns: 3.4rem minmax(0, 1fr);
    align-items: center;
    min-width: 0;
  }
  .clock {
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .block {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: 34px;
    padding: 0 var(--space-2) 0 4px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  :global([data-touch]) .block {
    min-height: var(--touch-row);
  }
  .long {
    flex: none;
    margin-inline-start: auto;
    color: var(--muted-strong);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .running .long {
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }
  .unset {
    border: 1px dashed var(--line-strong);
    background: none;
    box-shadow: none;
  }
  .choose {
    flex: none;
    min-width: 0;
  }
</style>
