<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { MARKS } from '../../marks/src/api'
  import type { IconNode } from '../../ui-kit/src/api'
  import { PIXELS } from '../../springs/src/api'
  import type { Dial } from './dial.svelte'
  import { lineTitle, type NewKindRow } from './new-kinds'
  import { FOLLOWING, Motion, Spring, Springs, TRAILING } from './springs.svelte'
  import type { Picked, Shape, SunHand } from './sun-hand'
  import type { Slot } from './sun-slots'
  import { countsOf } from './sun-slots'
  import { MIDDLE, RESTING } from './sun-keys'
  import {
    aimed,
    arcPath,
    at as pointAt,
    bridgePiece,
    centreOf,
    HUB,
    GAP,
    INNER,
    LIFT,
    middleOf,
    optionPiece,
    outlineOf,
    type Piece,
    type Point,
    PULL,
    quarterPiece,
    REACH,
  } from './sun-shape'

  const {
    slots,
    dial,
    hand,
    touch,
    locked = false,
    letters = true,
    onpick,
    onready,
    oncentre,
  }: {
    slots: (Slot<NewKindRow> | null)[]
    dial: Dial
    hand: SunHand
    touch: boolean
    locked?: boolean
    letters?: boolean
    onpick: (slot: number, index: number, how: Picked) => void
    onready: (one: NewKindRow) => void
    oncentre?: () => void
  } = $props()

  const EACH = 64
  const LEAVING = 160
  const MOVED = 8
  const OPEN_STAGGER = 45
  const CLOSE_STAGGER = 18
  const trails = new Springs()
  const trailX = trails.add(new Spring(FOLLOWING, TRAILING, PIXELS))
  const trailY = trails.add(new Spring(FOLLOWING, TRAILING, PIXELS))
  const motion = new Motion()
  const layout = $derived(slots.map((slot) => slot?.kinds.map((one) => one.kind).join(' ') ?? '').join('|'))
  let trailing = $state(false)
  let root = $state<HTMLElement>()
  let svg = $state<SVGSVGElement>()
  let size = $state(0)
  let leaving = 0
  let swallow = false
  let drag: { id: number; x: number; y: number; moved: boolean } | null = null
  const counts = $derived(countsOf(slots))
  const scale = $derived(size > 0 ? size / (REACH * 2) : 1)
  const labelled = $derived(scale >= 0.7)
  const titled = $derived(scale >= 0.42)
  const words = $derived(Math.min(19, 15 / Math.max(scale, 0.01)))

  function pieceOf(slot: number, index: number, one: NewKindRow, count: number): Piece {
    const { value: grown } = motion.grow(slot, one.kind)
    return optionPiece(slot, index, count, grown, motion.lift(slot).value, motion.pull(slot, one.kind).value)
  }
  const iconOf = (one: NewKindRow): IconNode => one.icon ?? MARKS[one.mark]
  const iconOfSlot = ({ kinds: [first] }: Slot<NewKindRow>): IconNode => (first ? iconOf(first) : [])
  const lifted = (slot: number): string => {
    const [x, y] = pointAt(LIFT * motion.lift(slot).value, middleOf(slot))
    return `translate(${x.toFixed(2)} ${y.toFixed(2)})`
  }
  const titleOf = (slot: Slot<NewKindRow>): string =>
    slot.kinds.length === 1 ? (slot.kinds[0]?.label() ?? '') : lineTitle(slot.line)
  const spotOf = (slot: number): Point => pointAt((HUB + INNER) / 2 + 4, middleOf(slot))

  $effect.pre(() => {
    const open = dial.open
    const kinds = layout.split('|').map((line) => (line ? line.split(' ') : null))
    const moving = motion
    untrack(() => {
      moving.fit(kinds)
      slots.forEach((slot, index) => {
        if (!slot) return
        const on = index === open
        moving.lift(index).aim(on ? 1 : 0)
        slot.kinds.forEach((one, at) => {
          const delay = on ? at * OPEN_STAGGER : (slot.kinds.length - 1 - at) * CLOSE_STAGGER
          moving.grow(index, one.kind).aim(on ? 1 : 0, delay)
          if (!on) moving.pull(index, one.kind).aim(0)
        })
      })
      moving.wake()
    })
  })
  $effect(() => {
    const open = dial.open
    const index = dial.index
    if (open === null || index === null) return
    const one = slots[open]?.kinds[index]
    if (one) untrack(() => onready(one))
  })

  function calm() {
    clearTimeout(leaving)
    leaving = 0
  }
  function closeSoon() {
    if (leaving) return
    leaving = window.setTimeout(() => {
      leaving = 0
      dial.aim = RESTING
    }, LEAVING)
  }
  function hovered(target: EventTarget | null): { slot: number | null; index: number | null } {
    const element = target instanceof Element ? target : null
    const group = element?.closest<SVGElement>('[data-slot]')
    if (!group) return { slot: null, index: null }
    const slot = Number(group.dataset.slot)
    const option = element?.closest<SVGElement>('[data-index]')
    if (!option) return { slot, index: null }
    if (dial.open !== slot) return { slot: null, index: null }
    return { slot, index: Number(option.dataset.index) }
  }
  function hover(event: PointerEvent) {
    if (touch || event.pointerType === 'touch' || drag?.moved || locked) return
    const { slot, index } = hovered(event.target)
    if (slot === null) {
      if (dial.open !== null || dial.index !== null) closeSoon()
      return
    }
    calm()
    if (dial.open !== slot || dial.index !== index || dial.hub) dial.aim = { hub: false, open: slot, index }
  }
  function leave(event: PointerEvent) {
    if (touch || event.pointerType === 'touch' || drag?.moved || locked) return
    if (dial.open !== null) closeSoon()
  }

  function screenMatrix(): DOMMatrix | null {
    return svg && 'getScreenCTM' in svg ? svg.getScreenCTM() : null
  }
  function dialPoint(x: number, y: number): Point | null {
    const matrix = screenMatrix()
    if (!matrix) return null
    const point = new DOMPoint(x, y).matrixTransform(matrix.inverse())
    return [point.x, point.y]
  }
  function aimAt(x: number, y: number): { slot: number; index: number } | null {
    const found = aimed(x, y, dial.open, counts)
    dial.aim = { hub: true, open: found.open, index: found.index }
    slots.forEach((slot, at) =>
      slot?.kinds.forEach((one, index) =>
        motion.pull(at, one.kind).aim(found.open === at && found.index === index ? found.pull : 0),
      ),
    )
    motion.wake()
    if (found.open === null || found.index === null || found.pull < PULL) return null
    return { slot: found.open, index: found.index }
  }
  function trail(on: boolean, x = 0, y = 0) {
    trailing = on
    trailX.aim(x)
    trailY.aim(y)
    trails.wake()
  }
  function relax() {
    slots.forEach((slot, at) => slot?.kinds.forEach((one) => motion.pull(at, one.kind).aim(0)))
    motion.wake()
  }
  function press(event: PointerEvent) {
    if (locked || event.button > 0) return
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
  }
  function move(event: PointerEvent) {
    if (drag?.id !== event.pointerId) {
      hover(event)
      return
    }
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < MOVED) {
        hover(event)
        return
      }
      const start = dialPoint(drag.x, drag.y)
      if (!start) return
      drag.moved = true
      calm()
      try {
        root?.setPointerCapture(event.pointerId)
      } catch {
        return
      }
      trailX.jump(0)
      trailY.jump(0)
    }
    const point = dialPoint(event.clientX, event.clientY)
    if (!point) return
    trail(true, point[0], point[1])
    const commit = aimAt(point[0], point[1])
    if (!commit) return
    drag = null
    swallow = true
    trail(false)
    onpick(commit.slot, commit.index, 'pull')
  }
  function lift(event: PointerEvent) {
    if (drag?.id !== event.pointerId) return
    const moved = drag.moved
    drag = null
    if (!moved) return
    swallow = true
    trail(false)
    relax()
    dial.aim = RESTING
  }
  function click(event: MouseEvent) {
    if (swallow) {
      swallow = false
      return
    }
    if (locked) return
    const element = event.target instanceof Element ? event.target : null
    if (element?.closest('.hub')) {
      dial.aim = MIDDLE
      oncentre?.()
      return
    }
    const group = element?.closest<SVGElement>('[data-slot]')
    if (!group) return
    const slot = Number(group.dataset.slot)
    const found = slots[slot]
    if (!found) return
    const option = element?.closest<SVGElement>('[data-index]')
    if (option && dial.open === slot) {
      const index = Number(option.dataset.index)
      onpick(slot, index, event.shiftKey ? 'others' : 'click')
      return
    }
    if (found.kinds.length === 1) {
      onpick(slot, 0, event.shiftKey ? 'others' : 'click')
      return
    }
    if (touch || dial.open !== slot) dial.aim = dial.open === slot ? MIDDLE : { hub: false, open: slot, index: null }
  }
  function menu(event: MouseEvent) {
    const element = event.target instanceof Element ? event.target : null
    const option = element?.closest<SVGElement>('[data-index]')
    const group = element?.closest<SVGElement>('[data-slot]')
    if (!option || !group) return
    const slot = Number(group.dataset.slot)
    const index = Number(option.dataset.index)
    if (!slots[slot]?.kinds[index]?.others) return
    event.preventDefault()
    onpick(slot, index, 'others')
  }

  function settled(slot: number, index: number): Promise<void> {
    const one = slots[slot]?.kinds[index]
    if (!one) return Promise.resolve()
    const spring = motion.grow(slot, one.kind)
    const until = performance.now() + 700
    return new Promise((done) => {
      const look = () => {
        if (spring.value > 0.98 || performance.now() > until) done()
        else requestAnimationFrame(look)
      }
      look()
    })
  }
  function shapeOf(slot: number, index: number): Shape | null {
    const found = slots[slot]
    const one = found?.kinds[index]
    const matrix = screenMatrix()
    if (!found || !one || !matrix) return null
    const screen = ([x, y]: Point): Point => [
      matrix.a * x + matrix.c * y + matrix.e,
      matrix.b * x + matrix.d * y + matrix.f,
    ]
    return { outline: outlineOf(pieceOf(slot, index, one, found.kinds.length), EACH).map(screen), each: EACH }
  }

  $effect.pre(() => {
    hand.settled = settled
    hand.shapeOf = shapeOf
  })

  onMount(() => {
    const watching = new ResizeObserver(([entry]) => {
      if (entry) size = entry.contentRect.width
    })
    if (root) watching.observe(root)
    const keyed = () => calm()
    window.addEventListener('keydown', keyed, true)
    return () => {
      watching.disconnect()
      window.removeEventListener('keydown', keyed, true)
      clearTimeout(leaving)
      trails.stop()
      motion.stop()
    }
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="sun"
  bind:this={root}
  class:dim={dial.open !== null}
  style:--words={`${words}px`}
  onpointerdown={press}
  onpointermove={move}
  onpointerup={lift}
  onpointercancel={lift}
  onpointerleave={leave}
  onclick={click}
  oncontextmenu={menu}
>
  <svg bind:this={svg} viewBox={`${-REACH} ${-REACH} ${REACH * 2} ${REACH * 2}`}>
    {#each slots as slot, at (at)}
      {#if slot}
        {@const count = slot.kinds.length}
        {@const open = dial.open === at}
        <g class="group" data-slot={at} data-line={slot.line}>
          <path class="bridge" d={open ? arcPath(bridgePiece(at, count)) : ''} />
          {#each slot.kinds as one, index (one.kind)}
            {@const piece = pieceOf(at, index, one, count)}
            {@const grown = motion.grow(at, one.kind).value}
            {@const pull = Math.min(1, motion.pull(at, one.kind).value / PULL)}
            {@const shown = Math.min(1, Math.max(0, (grown - 0.45) / 0.55))}
            {@const middle = centreOf(piece)}
            <g
              class="option"
              class:picked={dial.picked(at, index)}
              data-index={index}
              data-kind={one.kind}
              role="button"
              tabindex="-1"
              aria-label={one.label()}
              aria-keyshortcuts={letters ? one.letter.toUpperCase() : undefined}
              aria-hidden={!open}
              style:opacity={Math.min(1, grown * 2.2) *
                (1 - 0.65 * Math.max(0, Math.min(1, motion.pulled / PULL) - pull))}
            >
              <path
                class="shape"
                d={grown > 0.001 ? arcPath(piece) : ''}
                style:fill={dial.picked(at, index) && pull > 0.01
                  ? `color-mix(in srgb, var(--accent) ${(16 + 14 * pull).toFixed(1)}%, var(--surface))`
                  : undefined}
              />
              <g
                class="content"
                style:opacity={shown}
                transform={`translate(${middle[0].toFixed(2)} ${middle[1].toFixed(2)}) scale(${((0.85 + 0.15 * shown) * (1 + 0.12 * pull)).toFixed(3)})`}
              >
                <svg
                  class="glyph"
                  x={labelled ? -13 : -15}
                  y={labelled ? -35 : -23}
                  width={labelled ? 26 : 30}
                  height={labelled ? 26 : 30}
                  viewBox="0 0 24 24"
                >
                  {#each iconOf(one) as [tag, attrs] (JSON.stringify(attrs))}
                    <svelte:element this={tag} {...attrs} />
                  {/each}
                </svg>
                {#if labelled}
                  <text class="label" y={4}>{one.label()}</text>
                {/if}
                {#if letters}
                  <text class="key" y={labelled ? 26 : 22}>{one.letter.toUpperCase()}</text>
                {/if}
              </g>
            </g>
          {/each}
          <g
            class="quarter"
            class:open
            data-quarter={slot.line}
            role="button"
            tabindex="-1"
            aria-label={titleOf(slot)}
            aria-expanded={count > 1 ? open : undefined}
            transform={lifted(at)}
          >
            <path class="shape" d={arcPath(quarterPiece(at))} />
            <svg
              class="glyph"
              x={spotOf(at)[0] - 15}
              y={spotOf(at)[1] - (titled ? 27 : 15)}
              width="30"
              height="30"
              viewBox="0 0 24 24"
            >
              {#each iconOfSlot(slot) as [tag, attrs] (JSON.stringify(attrs))}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
            {#if titled}
              <text class="title" x={spotOf(at)[0]} y={spotOf(at)[1] + 18}>{lineTitle(slot.line)}</text>
            {/if}
          </g>
        </g>
      {:else}
        <path class="empty" d={arcPath(quarterPiece(at))} />
      {/if}
    {/each}
    <g class="trail" class:on={trailing}>
      <line x1="0" y1="0" x2={trailX.value} y2={trailY.value} />
      <circle class="dot" cx={trailX.value} cy={trailY.value} r="9" />
    </g>
  </svg>
  <button
    type="button"
    class="hub"
    class:picked={dial.hub}
    style:--hub={`${((HUB - GAP) * 2 * 100) / (REACH * 2)}%`}
    aria-label="Overview"
    aria-keyshortcuts="Space"
    aria-pressed={dial.hub}
  >
    {#if titled}<kbd>Space</kbd>{/if}
  </button>
</div>

<style>
  .sun {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .shape {
    fill: var(--surface);
    stroke: var(--line);
    stroke-width: 1;
    transition:
      fill var(--dur-fast) var(--ease-out),
      stroke var(--dur-fast) var(--ease-out);
  }
  .empty {
    fill: color-mix(in srgb, var(--surface) 45%, transparent);
    stroke: color-mix(in srgb, var(--line) 60%, transparent);
    stroke-width: 1;
    pointer-events: none;
  }
  .bridge {
    fill: transparent;
  }
  .glyph {
    color: var(--muted);
    stroke: currentColor;
    stroke-width: 1.6;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    overflow: visible;
    transition: color var(--dur-fast) var(--ease-out);
  }
  text {
    fill: var(--text);
    font-family: var(--font-ui);
    font-size: var(--words);
    text-anchor: middle;
    dominant-baseline: middle;
    pointer-events: none;
    transition: fill var(--dur-fast) var(--ease-out);
  }
  .key {
    fill: var(--muted);
    font-family: var(--font-mono);
    font-size: calc(var(--words) * 0.73);
  }
  .content {
    pointer-events: none;
  }
  .quarter {
    transition: opacity var(--dur-base) var(--ease-out);
    cursor: default;
  }
  .quarter,
  .option {
    outline: none;
  }
  .dim .quarter:not(.open) {
    opacity: 0.4;
  }
  .quarter.open .shape {
    fill: var(--surface-hover);
    stroke: var(--line-strong);
  }
  .quarter.open .glyph {
    color: var(--accent);
  }
  .quarter.open text {
    fill: var(--text-strong);
  }
  .option {
    cursor: default;
    transition: filter var(--dur-base) var(--ease-out);
  }
  .option.picked {
    filter: drop-shadow(0 0 14px color-mix(in srgb, var(--accent) 45%, transparent));
  }
  .option.picked .shape {
    fill: color-mix(in srgb, var(--accent) 16%, var(--surface));
    stroke: color-mix(in srgb, var(--accent) 90%, transparent);
  }
  .option.picked .glyph,
  .option.picked .key {
    color: var(--accent);
    fill: var(--accent);
  }
  .option.picked .glyph {
    fill: none;
  }
  .option.picked .label {
    fill: var(--text-strong);
  }
  .trail {
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .trail.on {
    opacity: 1;
  }
  .trail line {
    stroke: color-mix(in srgb, var(--accent) 75%, transparent);
    stroke-width: 2.5;
    stroke-linecap: round;
  }
  .trail .dot {
    fill: color-mix(in srgb, var(--accent) 22%, transparent);
    stroke: var(--accent);
    stroke-width: 1.5;
  }
  .hub {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--hub);
    height: var(--hub);
    translate: -50% -50%;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--surface);
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-base) var(--ease-out);
  }
  .hub:focus-visible {
    border-color: var(--line-strong);
    color: var(--text);
  }
  .hub:hover:not(.picked) {
    background: var(--surface-hover);
    border-color: var(--line-strong);
    color: var(--text);
  }
  .hub kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1;
    color: inherit;
  }
  .hub.picked {
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    border-color: color-mix(in srgb, var(--accent) 90%, transparent);
    color: var(--accent);
    box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 45%, transparent);
  }
</style>
