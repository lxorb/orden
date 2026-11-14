<script lang="ts">
  import type { Camera } from './camera'
  import { approach, arrived } from './canvas/ease'
  import { ALONE_INSET, heldAtEdge, INSET } from './canvas/edge'
  import { alone } from './alone.svelte'
  import { INK_STYLES, inkOpacity, inkPath, outlineOf } from './canvas/ink'
  import type { Palette } from './canvas/paint'
  import type { Hand } from './canvas/shared'
  import { stillness } from './platform/src/api'

  const {
    hands,
    unit,
    palette,
    camera,
    width,
    height,
    ongo,
  }: {
    hands: readonly Hand[]
    unit: number
    palette: Palette
    camera: Camera
    width: number
    height: number
    ongo?: (at: { x: number; y: number }) => void
  } = $props()

  const DOT = 4
  const GAP = 9
  const LABEL = 11
  const TARGET = 16
  const ARROW = 'M 11 0 L -6.6 -7.7 L -3.3 0 L -6.6 7.7 Z'

  const follows = (_value: unknown) => undefined

  function inked(colour: string): string {
    return palette[colour] ?? colour
  }

  const CATCHING_UP = 70

  let eased = $state.raw<Record<number, { x: number; y: number }>>({})
  let frame = 0
  let last = 0

  $effect(() => {
    for (const one of hands) follows(one.at)

    if (stillness() || !hands.length) {
      eased = Object.fromEntries(hands.map((one) => [one.id, one.at]))
      return
    }

    const tick = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16
      last = now

      const next: Record<number, { x: number; y: number }> = {}
      let moving = false

      for (const one of hands) {
        const was = eased[one.id]
        if (!was || arrived(was, one.at, unit)) {
          next[one.id] = one.at
          continue
        }

        next[one.id] = {
          x: approach(was.x, one.at.x, dt, CATCHING_UP),
          y: approach(was.y, one.at.y, dt, CATCHING_UP),
        }
        moving = true
      }

      eased = next
      if (moving) frame = requestAnimationFrame(tick)
      else frame = 0
    }

    last = 0
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      frame = 0
    }
  })

  const drawn = $derived(
    hands.map((one) => {
      const at = eased[one.id] ?? one.at
      return {
        one,
        at,
        held: heldAtEdge(at, camera, width, height, alone.on ? ALONE_INSET : INSET),
      }
    }),
  )

  const ALONG = { start: 1, middle: 0, end: -1, hanging: 1, auto: -1 } as const
</script>

{#if hands.length}
  <svg class="hands" aria-hidden="true" width="1" height="1" style:overflow="visible">
    {#each drawn as { one: hand, at, held } (hand.id)}
      {#if hand.stroke}
        <path
          d={inkPath(outlineOf(hand.stroke, false))}
          fill={inked(hand.stroke.color)}
          fill-opacity={inkOpacity(hand.stroke)}
          style:mix-blend-mode={INK_STYLES[hand.stroke.tool].multiply ? 'multiply' : 'normal'}
        />
      {/if}

      {#if held}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <g
          class="held"
          onpointerdown={(event) => event.stopPropagation()}
          onpointerup={(event) => event.stopPropagation()}
          onclick={(event) => {
            event.stopPropagation()
            ongo?.(at)
          }}
        >
          <circle
            class="target"
            cx={held.at.x}
            cy={held.at.y}
            r={TARGET * unit}
            fill="transparent"
          />
          <path
            d={ARROW}
            fill={hand.colour}
            transform="translate({held.at.x} {held.at.y}) rotate({held.angle}) scale({unit})"
          />
          <text
            x={held.at.x + ALONG[held.anchor] * GAP * 1.6 * unit}
            y={held.at.y + ALONG[held.baseline] * GAP * 1.6 * unit}
            text-anchor={held.anchor}
            dominant-baseline={held.baseline}
            fill={hand.colour}
            font-size="{LABEL * unit}px">{hand.name}</text
          >
        </g>
      {:else}
        <circle cx={at.x} cy={at.y} r={DOT * unit} fill={hand.colour} />
        <text
          x={at.x + GAP * unit}
          y={at.y - GAP * unit}
          fill={hand.colour}
          font-size="{LABEL * unit}px">{hand.name}</text
        >
      {/if}
    {/each}
  </svg>
{/if}

<style>
  .hands {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: var(--z-grip);
  }

  .held {
    pointer-events: auto;
    cursor: pointer;
  }

  .target {
    pointer-events: all;
  }

  text {
    font-family: var(--font-ui);
    font-weight: var(--weight-strong);
    transition: opacity var(--dur-base) var(--ease-out);
  }
</style>
