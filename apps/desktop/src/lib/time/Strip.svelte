<script lang="ts">
  import { i18n, t } from '../i18n.svelte'
  import { HOUR, MINUTE, piecesIn } from './days'
  import { bucketsOf } from './lanes'
  import { clock, nameOf, tintOf } from './look'
  import type { Minute } from './minutes'
  import type { Span } from './records'

  const {
    from,
    to,
    spans,
    minutes,
    now,
    hours = false,
  }: {
    from: number
    to: number
    spans: readonly Span[]
    minutes: readonly Minute[]
    now: number
    hours?: boolean
  } = $props()

  const whole = $derived(to - from)
  const at = (moment: number) => `${((moment - from) / whole) * 100}%`
  const wide = (ms: number) => `${Math.max(0.25, (ms / whole) * 100)}%`
  const nowShown = $derived(from <= now && now < to)
  const pieces = $derived(piecesIn(spans, from, to, now))
  const buckets = $derived(bucketsOf(minutes, from, to, 15 * MINUTE))
  let width = $state(0)
  const marks = $derived.by(() => {
    const step =
      [1, 2, 3, 4, 6, 12].map((one) => one * HOUR).find((one) => (one / whole) * width >= 48) ??
      12 * HOUR
    const out: number[] = []
    for (let one = Math.ceil(from / step) * step; one <= to; one += step) out.push(one)
    return out
  })
</script>

<div class="strip" dir="ltr" bind:clientWidth={width}>
  <div class="lanes">
    <div class="said">
      {#each pieces as piece (piece.span.id)}
        <span
          class="piece"
          style:left={at(piece.from)}
          style:width={wide(piece.to - piece.from)}
          style:background={tintOf(piece.span.activity)}
          title="{nameOf(piece.span.activity, t('No activity'))}, {clock(piece.from)}–{clock(
            piece.to,
          )}"
        ></span>
      {/each}
    </div>
    <div class="busy" aria-hidden="true">
      {#each buckets as bucket (bucket.from)}
        {#if bucket.seen > 0}
          <span
            class:away={bucket.away > bucket.active}
            style:left={at(bucket.from)}
            style:width={wide(15 * MINUTE)}
            style:height="{Math.max(
              12,
              Math.min(1, bucket.active / Math.max(bucket.seen, 0.01)) * 100,
            )}%"
          ></span>
        {/if}
      {/each}
    </div>
    {#if nowShown}
      <span class="now" style:left={at(now)}></span>
    {/if}
  </div>
  {#if hours}
    <div class="hours" aria-hidden="true">
      {#each marks as mark (mark)}
        <span
          style:left={at(mark)}
          style:translate={(mark - from) / whole < 0.08
            ? '0 0'
            : (mark - from) / whole > 0.92
              ? '-100% 0'
              : '-50% 0'}>{i18n.when(mark, { hour: 'numeric' })}</span
        >
      {/each}
    </div>
  {/if}
</div>

<style>
  .strip {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .lanes {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .said,
  .busy {
    position: relative;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    overflow: hidden;
  }

  .said {
    height: 14px;
  }

  .busy {
    height: 10px;
  }

  .said span,
  .busy span {
    position: absolute;
  }

  .said span {
    top: 0;
    bottom: 0;
    border-radius: 2px;
  }

  .busy span {
    bottom: 0;
    background: var(--accent);
    opacity: 0.5;
  }

  .busy span.away {
    background: repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 4px);
  }

  .now {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-inline-start: -1px;
    border-radius: 1px;
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
