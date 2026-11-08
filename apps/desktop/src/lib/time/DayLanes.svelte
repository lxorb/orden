<script lang="ts">
  import { i18n, t } from '../i18n.svelte'
  import { isOwn } from './counted'
  import { HOUR, MINUTE, piecesIn } from './days'
  import { type Band, bandsOf, bucketsOf, type Picked, stacked } from './lanes'
  import { clock, length, nameOf, placeTint, tintOf } from './look'
  import type { Minute } from './minutes'
  import type { Lane, Span } from './records'

  const {
    from,
    to,
    spans,
    own,
    minutes,
    now,
    picked,
    onpick,
  }: {
    from: number
    to: number
    spans: readonly Span[]
    own: readonly Span[]
    minutes: readonly Minute[]
    now: number
    picked: Picked | null
    onpick: (next: Picked | null) => void
  } = $props()

  const SNAP = 5 * MINUTE

  const nowShown = $derived(from <= now && now < to)

  const whole = $derived(to - from)
  const at = (moment: number) => `${((moment - from) / whole) * 100}%`
  const wide = (ms: number) => `${Math.max(0.2, (ms / whole) * 100)}%`
  const pixels = (ms: number) => (ms / whole) * width

  const said = $derived(stacked(piecesIn(own, from, to, now, isOwn)))
  const lanes = $derived(
    (
      [
        ['app', t('Apps')],
        ['site', t('Websites')],
        ['space', t('Spaces')],
        ['tab', t('Tabs')],
      ] as const
    ).map(([lane, label]): { lane: Lane; label: string; bands: Band[] } => ({
      lane,
      label,
      bands: bandsOf(spans, lane, from, to, now),
    })),
  )
  const buckets = $derived(bucketsOf(minutes, from, to, SNAP))
  let width = $state(0)
  const hours = $derived.by(() => {
    const out: number[] = []
    const step =
      [1, 2, 3, 4, 6, 12].map((one) => one * HOUR).find((one) => (one / whole) * width >= 64) ??
      12 * HOUR
    for (let one = Math.ceil(from / step) * step; one <= to; one += step) out.push(one)
    return out
  })

  const line = (read: (one: (typeof buckets)[number]) => number | null): string => {
    const points: string[] = []
    for (const one of buckets) {
      const value = read(one)
      if (value === null) continue
      const x = ((one.from + SNAP / 2 - from) / whole) * 1000
      points.push(`${x.toFixed(1)},${(30 - value * 28).toFixed(1)}`)
    }
    return points.join(' ')
  }
  const cpu = $derived(line((one) => one.cpu))
  const memory = $derived(line((one) => one.memory))
  const battery = $derived(line((one) => one.battery))

  let track = $state<HTMLElement>()
  let pressed: { x: number; at: number; span: string | null } | null = null
  let dragging = $state(false)

  function timeAt(x: number): number {
    const box = track?.getBoundingClientRect()
    if (!box?.width) return from
    const share = Math.min(1, Math.max(0, (x - box.left) / box.width))
    return Math.round((from + share * whole) / SNAP) * SNAP
  }

  function down(event: PointerEvent) {
    if (event.button !== 0) return
    const hit = (event.target as Element | null)?.closest<HTMLElement>('[data-span]')
    pressed = { x: event.clientX, at: timeAt(event.clientX), span: hit?.dataset.span ?? null }
    track?.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent) {
    if (!pressed) return
    if (!dragging && Math.abs(event.clientX - pressed.x) < 4) return
    dragging = true
    const here = timeAt(event.clientX)
    onpick({
      from: Math.min(pressed.at, here),
      to: Math.max(pressed.at, here, Math.min(pressed.at, here) + SNAP),
      span: null,
    })
  }

  function up() {
    const was = pressed
    pressed = null
    if (dragging) {
      dragging = false
      return
    }
    if (!was) return
    const span = was.span ? own.find((one) => one.id === was.span) : undefined
    onpick(
      span
        ? { from: span.start, to: span.end ?? now, span: span.id }
        : picked
          ? null
          : {
              from: Math.floor(was.at / HOUR) * HOUR,
              to: Math.floor(was.at / HOUR) * HOUR + HOUR,
              span: null,
            },
    )
  }
</script>

<div class="day" dir="ltr">
  <div class="labels" aria-hidden="true">
    <span class="axis"></span>
    <span class="said-label">{t('You said')}</span>
    {#each lanes as lane (lane.lane)}
      <span class="lane-label">{lane.label}</span>
    {/each}
    <span class="busy-label">{t('Active')}</span>
    <span class="system-label">{t('System')}</span>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="track"
    class:dragging
    bind:this={track}
    bind:clientWidth={width}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => {
      pressed = null
      dragging = false
    }}
  >
    <div class="axis">
      {#each hours as hour (hour)}
        <span style:left={at(hour)}>{i18n.when(hour, { hour: 'numeric' })}</span>
      {/each}
    </div>

    <div class="said">
      {#each said as { item: piece, row, rows } (piece.span.id)}
        <button
          type="button"
          class="block"
          class:on={picked?.span === piece.span.id}
          data-span={piece.span.id}
          style:left={at(piece.from)}
          style:width={wide(piece.to - piece.from)}
          style:top="{(row / rows) * 100}%"
          style:height="{100 / rows}%"
          style:--tint={tintOf(piece.span.activity)}
          title="{nameOf(piece.span.activity, t('No activity'))}, {clock(piece.from)}–{clock(
            piece.to,
          )}"
        >
          {#if pixels(piece.to - piece.from) > 40}
            <span class="name" dir="auto">{nameOf(piece.span.activity, t('No activity'))}</span>
            {#if rows === 1 && pixels(piece.to - piece.from) > 52}
              <span class="long">{length(piece.to - piece.from)}</span>
            {/if}
          {/if}
        </button>
      {/each}
    </div>

    {#each lanes as lane (lane.lane)}
      <div class="lane">
        {#each lane.bands as band (`${band.key}-${band.from}`)}
          <span
            class="band"
            style:left={at(band.from)}
            style:width={wide(band.to - band.from)}
            style:--tint={placeTint(band.key)}
            title="{band.label}, {clock(band.from)}–{clock(band.to)}"
            dir="auto"
            >{#if pixels(band.to - band.from) > 48}{band.label}{/if}</span
          >
        {/each}
      </div>
    {/each}

    <div class="busy">
      {#each buckets as bucket (bucket.from)}
        {#if bucket.seen > 0}
          <span
            class:away={bucket.away > bucket.active}
            style:left={at(bucket.from)}
            style:width={wide(SNAP)}
            style:height="{Math.max(8, Math.min(1, bucket.active / bucket.seen) * 100)}%"
          ></span>
        {/if}
      {/each}
    </div>

    <svg class="system" viewBox="0 0 1000 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline class="memory" points={memory} />
      <polyline class="battery" points={battery} />
      <polyline class="cpu" points={cpu} />
    </svg>

    {#each hours as hour (hour)}
      <span class="tick" style:left={at(hour)}></span>
    {/each}

    {#if nowShown}
      <span class="now" style:left={at(now)}></span>
    {/if}

    {#if picked}
      <span
        class="picked"
        style:left={at(Math.max(from, picked.from))}
        style:width={wide(Math.min(to, picked.to) - Math.max(from, picked.from))}
      ></span>
    {/if}
  </div>

  <div class="legend" aria-hidden="true">
    <span><i class="cpu"></i>{t('CPU')}</span>
    <span><i class="memory"></i>{t('Memory')}</span>
    <span><i class="battery"></i>{t('Battery')}</span>
  </div>
</div>

<style>
  .day {
    --said: 52px;
    --lane: 24px;
    --busy: 34px;
    --system: 40px;
    --axis: 18px;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: var(--space-3);
    user-select: none;
    -webkit-user-select: none;
  }

  .labels {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--muted);
    font-size: var(--text-xs);
    text-align: end;
  }

  .labels span {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    white-space: nowrap;
  }

  .labels .axis {
    height: var(--axis);
  }

  .said-label {
    height: var(--said);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .lane-label {
    height: var(--lane);
  }

  .busy-label {
    height: var(--busy);
  }

  .system-label {
    height: var(--system);
  }

  .track {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    cursor: crosshair;
    touch-action: pan-y;
  }

  .track > .axis {
    position: relative;
    height: var(--axis);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .track > .axis span {
    position: absolute;
    translate: -50% 0;
    white-space: nowrap;
  }

  .said,
  .lane,
  .busy {
    position: relative;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .said {
    height: var(--said);
  }

  .lane {
    height: var(--lane);
    overflow: hidden;
  }

  .busy {
    height: var(--busy);
    overflow: hidden;
  }

  .block {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 3px;
    padding: 0 var(--space-2);
    overflow: hidden;
    border: 2px solid transparent;
    border-radius: calc(var(--radius-sm) + 2px);
    background: var(--tint) padding-box;
    color: var(--accent-ink);
    font: inherit;
    font-size: var(--text-xs);
    text-align: start;
    cursor: pointer;
  }

  .block.on {
    outline: 2px solid var(--text-strong);
    outline-offset: 1px;
  }

  .block .name {
    overflow: hidden;
    font-weight: var(--weight-strong);
    text-align: match-parent;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .block .long {
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
  }

  .band {
    position: absolute;
    top: 2px;
    bottom: 2px;
    padding: 0 var(--space-1);
    overflow: hidden;
    border-radius: 3px;
    background: color-mix(in srgb, var(--tint) 30%, transparent);
    box-shadow: inset 2px 0 0 var(--tint);
    color: var(--text-strong);
    font-size: 11px;
    line-height: 18px;
    text-align: match-parent;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .busy span {
    position: absolute;
    bottom: 0;
    background: var(--accent);
    opacity: 0.55;
  }

  .busy span.away {
    background: repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 4px);
    opacity: 0.8;
  }

  .system {
    width: 100%;
    height: var(--system);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .system polyline {
    fill: none;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

  .cpu {
    stroke: var(--accent);
  }

  .memory {
    stroke: var(--muted);
  }

  .battery {
    stroke: var(--success);
  }

  .tick {
    position: absolute;
    top: var(--axis);
    bottom: 0;
    width: 1px;
    background: var(--line);
    opacity: 0.5;
    pointer-events: none;
  }

  .now {
    position: absolute;
    top: calc(var(--axis) - 2px);
    bottom: 0;
    width: 2px;
    margin-inline-start: -1px;
    background: var(--danger);
    pointer-events: none;
  }

  .picked {
    position: absolute;
    top: var(--axis);
    bottom: 0;
    border-inline: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    pointer-events: none;
  }

  .legend {
    grid-column: 2;
    display: flex;
    gap: var(--space-3);
    margin-top: var(--space-1);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .legend i {
    width: 10px;
    height: 2px;
    border-radius: 1px;
  }

  .legend i.cpu {
    background: var(--accent);
  }

  .legend i.memory {
    background: var(--muted);
  }

  .legend i.battery {
    background: var(--success);
  }
</style>
