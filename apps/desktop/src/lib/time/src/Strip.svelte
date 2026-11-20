<script lang="ts">
  import { localDate } from '../../platform/src/api'
  import { isOwn } from './counted'
  import { HOUR, piecesIn } from './days'
  import { clock, nameOf, tintOf } from './look'
  import type { Span } from './records'

  const { from, to, spans, now }: { from: number; to: number; spans: readonly Span[]; now: number } = $props()
  const whole = $derived(to - from)
  const at = (moment: number) => `${((moment - from) / whole) * 100}%`
  const wide = (ms: number) => `${Math.max(0.4, (ms / whole) * 100)}%`
  const nowShown = $derived(from <= now && now < to)
  const pieces = $derived(piecesIn(spans, from, to, now, isOwn))
  let width = $state(0)
  const marks = $derived.by(() => {
    const step = [1, 2, 3, 4, 6, 12].map((one) => one * HOUR).find((one) => (one / whole) * width >= 48) ?? 12 * HOUR
    const out: number[] = []
    for (let one = Math.ceil(from / step) * step; one <= to; one += step) out.push(one)
    return out
  })
</script>

<div class="strip" dir="ltr" bind:clientWidth={width} data-time-strip>
  <div class="bar">
    {#each pieces as piece (piece.span.id)}
      <span
        style:left={at(piece.from)}
        style:width={wide(piece.to - piece.from)}
        style:background={tintOf(piece.span.activity)}
        title="{nameOf(piece.span.activity, 'No activity')}, {clock(piece.from)}–{clock(piece.to)}"
      ></span>
    {/each}
    {#if nowShown}<span class="now" style:left={at(now)}></span>{/if}
  </div>
  <div class="hours" aria-hidden="true">
    {#each marks as mark (mark)}
      <span
        style:left={at(mark)}
        style:translate={(mark - from) / whole < 0.08 ? '0 0' : (mark - from) / whole > 0.92 ? '-100% 0' : '-50% 0'}
        >{localDate(mark, { hour: 'numeric' })}</span
      >
    {/each}
  </div>
</div>

<style>
  .strip {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bar {
    position: relative;
    height: 10px;
    overflow: hidden;
    border-radius: 5px;
    background: var(--surface-2);
  }
  .bar span {
    position: absolute;
    top: 0;
    bottom: 0;
  }
  .bar .now {
    width: 2px;
    margin-inline-start: -1px;
    background: var(--danger);
  }
  .hours {
    position: relative;
    height: 1.1em;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  .hours span {
    position: absolute;
    white-space: nowrap;
  }
</style>
