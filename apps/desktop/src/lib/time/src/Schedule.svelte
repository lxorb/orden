<script lang="ts">
  import { DIVIDER, menu } from '../../ui-kit/src/api'
  import ActivityLayer from './ActivityLayer.svelte'
  import ActivityMark from './ActivityMark.svelte'
  import { isOwn } from './counted'
  import { MINUTE, piecesIn } from './days'
  import { clock, length, nameOf, tintOf } from './look'
  import type { Minute } from './minutes'
  import { moveBlock, placeBlock, removeBlock, resizeBlock, setActivity, unset } from './schedule'
  import { time } from './time.svelte'

  const {
    from,
    to,
    now,
    minutes,
    width,
    selected,
    onselect,
    onmanage,
  }: {
    from: number
    to: number
    now: number
    minutes: readonly Minute[]
    width: number
    selected: string | null
    onselect: (id: string | null) => void
    onmanage: () => void
  } = $props()
  const SNAP = 5 * MINUTE
  type Kind = 'make' | 'move' | 'start' | 'end'
  interface Drag {
    kind: Kind
    id: string | null
    x: number
    at: number
    a: number
    b: number
    moved: boolean
  }
  interface Asking {
    from: number
    to: number
    id: string | null
  }
  const whole = $derived(to - from)
  const at = (moment: number) => `${((moment - from) / whole) * 100}%`
  const wide = (ms: number) => `${Math.max(0, (ms / whole) * 100)}%`
  const pixels = (ms: number) => (ms / whole) * width
  const blocks = $derived(piecesIn(time.spans, from, to, now, isOwn))
  const loose = $derived(unset(time.spans, minutes, from, to, now))
  let track = $state<HTMLElement | null>(null)
  let drag = $state<Drag | null>(null)
  let asking = $state<Asking | null>(null)
  let anchor = $state<HTMLElement | null>(null)
  const snap = (moment: number) => Math.round(moment / SNAP) * SNAP
  function timeAt(x: number): number {
    const box = track?.getBoundingClientRect()
    if (!box?.width) return from
    return from + Math.min(1, Math.max(0, (x - box.left) / box.width)) * whole
  }
  function shownOf(id: string, start: number, end: number): [number, number] {
    if (drag?.moved && drag.id === id && drag.kind !== 'make') return [drag.a, drag.b]
    return [start, end]
  }
  function down(event: PointerEvent) {
    if (event.button !== 0 || asking) return
    const target = event.target as Element | null
    if (target?.closest('[data-unset]')) return
    const block = target?.closest<HTMLElement>('[data-block]')
    const id = block?.dataset.block ?? null
    const span = id === null ? null : time.span(id)
    const edge = target?.closest<HTMLElement>('[data-edge]')?.dataset.edge
    const here = timeAt(event.clientX)
    const kind: Kind = edge === 'start' || edge === 'end' ? edge : span ? 'move' : 'make'
    const end = span ? (span.end ?? now) : snap(here)
    drag = { kind, id, x: event.clientX, at: here, a: span?.start ?? snap(here), b: end, moved: false }
    track?.setPointerCapture(event.pointerId)
    track?.focus({ preventScroll: true })
  }
  function move(event: PointerEvent) {
    const was = drag
    if (!was) return
    if (!was.moved && Math.abs(event.clientX - was.x) < 4) return
    const here = timeAt(event.clientX)
    const span = was.id === null ? null : time.span(was.id)
    let { a, b } = was
    if (was.kind === 'make') {
      const start = snap(was.at)
      a = Math.min(start, snap(here))
      b = Math.max(start, snap(here))
    } else if (span && was.kind === 'move') {
      if (span.end === null) return
      a = snap(span.start + here - was.at)
      b = a + span.end - span.start
    } else if (span && was.kind === 'start') {
      a = Math.min(snap(here), (span.end ?? now) - SNAP)
      b = span.end ?? now
    } else if (span && was.kind === 'end') {
      a = span.start
      b = Math.max(snap(here), span.start + SNAP)
    }
    drag = { ...was, a, b, moved: true }
  }
  function up() {
    const was = drag
    drag = null
    if (!was) return
    if (!was.moved) {
      onselect(was.id)
      return
    }
    if (was.kind === 'make') {
      if (was.b - was.a >= SNAP) asking = { from: was.a, to: was.b, id: null }
      return
    }
    if (was.id === null) return
    if (was.kind === 'move') time.schedule(moveBlock(time.spans, was.id, was.a, now))
    else time.schedule(resizeBlock(time.spans, was.id, was.a, was.b, now))
    onselect(was.id)
  }
  function picked(activity: string) {
    const ask = asking
    if (!ask) return
    if (ask.id !== null) {
      time.schedule(setActivity(time.spans, ask.id, activity))
      onselect(ask.id)
      return
    }
    const id = crypto.randomUUID()
    time.schedule(placeBlock(time.spans, ask.from, ask.to, activity, now, id))
    onselect(id)
  }
  function remove(id: string) {
    time.schedule(removeBlock(time.spans, id))
    if (selected === id) onselect(null)
  }
  function keyed(event: KeyboardEvent) {
    if (event.target !== track) return
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== null) {
      event.preventDefault()
      remove(selected)
    } else if (event.key === 'Escape' && selected !== null) {
      event.preventDefault()
      onselect(null)
    }
  }
  function blockMenu(event: MouseEvent, id: string) {
    event.preventDefault()
    onselect(id)
    const span = time.span(id)
    if (!span) return
    menu.show(
      event,
      [
        { label: 'Change activity', run: () => (asking = { from: span.start, to: span.end ?? now, id }) },
        DIVIDER,
        { label: 'Delete', danger: true, run: () => remove(id) },
      ],
      { title: nameOf(span.activity, 'No activity') },
    )
  }
  const said = (activity: string | null, start: number, end: number) =>
    `${nameOf(activity, 'No activity')}, ${clock(start)}–${clock(end)}, ${length(end - start)}`
</script>

<div
  class="schedule"
  class:dragging={drag?.moved}
  role="listbox"
  aria-label="Schedule"
  tabindex="0"
  data-time-schedule
  bind:this={track}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={() => (drag = null)}
  onkeydown={keyed}
>
  {#each loose as one (one.from)}
    <button
      type="button"
      class="unset"
      data-unset
      style:left={at(one.from)}
      style:width={wide(one.to - one.from)}
      title="Not set, {clock(one.from)}–{clock(one.to)}"
      onclick={() => (asking = { from: one.from, to: one.to, id: null })}
    >
      {#if pixels(one.to - one.from) > 52}<span class="name">Not set</span>{/if}
    </button>
  {/each}
  {#each blocks as piece (piece.span.id)}
    {@const [start, end] = shownOf(piece.span.id, piece.from, piece.to)}
    <div
      class="block"
      class:on={selected === piece.span.id}
      class:running={piece.span.end === null}
      role="option"
      aria-selected={selected === piece.span.id}
      tabindex="-1"
      data-block={piece.span.id}
      style:left={at(Math.max(from, start))}
      style:width={wide(Math.min(to, end) - Math.max(from, start))}
      style:--tint={tintOf(piece.span.activity)}
      title={said(piece.span.activity, start, end)}
      oncontextmenu={(event) => blockMenu(event, piece.span.id)}
    >
      <span class="edge start" data-edge="start"></span>
      {#if pixels(end - start) > 22}
        <span class="what">
          <ActivityMark activity={piece.span.activity} size={13} />
          {#if pixels(end - start) > 64}<span class="name" dir="auto">{nameOf(piece.span.activity, 'No activity')}</span
            >{/if}
        </span>
      {/if}
      {#if piece.span.end !== null}<span class="edge end" data-edge="end"></span>{/if}
    </div>
  {/each}
  {#if drag?.moved && drag.kind === 'make'}
    <span class="ghost" style:left={at(drag.a)} style:width={wide(drag.b - drag.a)}></span>
  {/if}
  {#if asking}
    <span
      class="ghost asked"
      bind:this={anchor}
      style:left={at(asking.from)}
      style:width={wide(asking.to - asking.from)}
    ></span>
    {#if anchor}
      <ActivityLayer
        from={anchor}
        chosen={asking.id === null ? null : (time.span(asking.id)?.activity ?? null)}
        onpick={picked}
        {onmanage}
        onclose={() => (asking = null)}
      />
    {/if}
  {/if}
</div>

<style>
  .schedule {
    position: relative;
    height: 56px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    cursor: crosshair;
    touch-action: pan-y;
  }
  .block,
  .unset,
  .ghost {
    position: absolute;
    top: 4px;
    bottom: 4px;
    min-width: 3px;
    border-radius: var(--radius-sm);
  }
  .block {
    display: flex;
    align-items: center;
    overflow: hidden;
    background: color-mix(in srgb, var(--tint) 26%, var(--surface));
    box-shadow: inset 3px 0 0 var(--tint);
    color: var(--text-strong);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    cursor: grab;
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }
  .dragging .block,
  .dragging {
    cursor: grabbing;
  }
  .block.on {
    box-shadow:
      inset 3px 0 0 var(--tint),
      0 0 0 2px var(--tint);
  }
  .block.running {
    background: linear-gradient(
      to right,
      color-mix(in srgb, var(--tint) 26%, var(--surface)) 70%,
      color-mix(in srgb, var(--tint) 10%, var(--surface))
    );
  }
  .what {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    padding-inline: var(--space-2);
    pointer-events: none;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .edge.start {
    left: 0;
  }
  .edge.end {
    right: 0;
  }
  .unset {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px dashed var(--line-strong);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }
  @media (hover: hover) {
    .unset:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }
  .ghost {
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    pointer-events: none;
  }
</style>
