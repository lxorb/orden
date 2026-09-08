<script lang="ts">
  /** The other hands on the plane: what each is drawing, and where each one is.
   *
   *  A note draws a thin bar in the other device's colour where its caret is, with
   *  its name above it for a moment after it moves. A plane has no line of text to
   *  put a bar in, so the same fact is said the same way in the place a plane has:
   *  a small dot in that device's accent where its pointer is, its name beside it,
   *  and the stroke under its pen drawn as it is drawn.
   *
   *  One SVG layer for all of it, inside the plane, so a pan and a zoom are the
   *  plane's own transform and nothing here is touched. SVG rather than a third 2d
   *  canvas because this is a handful of shapes that change every frame and go
   *  away again: exactly what a retained-mode layer is for, and the outline comes
   *  from `ink.ts` like every other picture of a stroke, so what is drawn here and
   *  what lands when the pen lifts are the same shape.
   *
   *  A stroke here is nobody's object yet. It is not on the plane, not in the
   *  file, and not anybody's to pick or erase; it arrives over awareness and is
   *  gone the moment that device lifts its pen. The finished stroke comes the
   *  ordinary way, once, as one whole object in the room's document. */

  import { INK_STYLES, inkOpacity, inkPath, outlineOf } from './canvas/ink'
  import type { Palette } from './canvas/paint'
  import type { Hand } from './canvas/shared'

  const {
    hands,
    unit,
    palette,
  }: {
    hands: readonly Hand[]
    /** One screen pixel in plane units, so the dot and the name are the same size
     *  on screen at every zoom. */
    unit: number
    /** What the six preset colours are, read off the theme. */
    palette: Palette
  } = $props()

  /** How long a name stays after the hand it belongs to has stopped moving. The
   *  same second and a half a caret's name is shown for. */
  const NAMED = 1500

  /** How big the pointer is and how far its name sits from it, in screen pixels. */
  const DOT = 4
  const GAP = 9
  const LABEL = 11

  let named = $state(true)
  let timer: ReturnType<typeof setTimeout> | undefined

  /** Reads a value for its own sake, so the effect around it follows it. */
  const follows = (_value: unknown) => undefined

  // A hand that moved is a hand worth naming, and after a pause the name goes and
  // the dot stays, which is what a caret does.
  $effect(() => {
    for (const one of hands) follows(one.at)
    named = true

    clearTimeout(timer)
    timer = setTimeout(() => (named = false), NAMED)
    return () => clearTimeout(timer)
  })

  function inked(colour: string): string {
    return palette[colour] ?? colour
  }
</script>

{#if hands.length}
  <svg class="hands" aria-hidden="true" width="1" height="1" style:overflow="visible">
    {#each hands as hand (hand.id)}
      {#if hand.stroke}
        <!-- Open ended, because the pen has not lifted: the same outline the ink
             layers fill, drawn the one way `ink.ts` describes it. -->
        <path
          d={inkPath(outlineOf(hand.stroke, false))}
          fill={inked(hand.stroke.color)}
          fill-opacity={inkOpacity(hand.stroke)}
          style:mix-blend-mode={INK_STYLES[hand.stroke.tool].multiply ? 'multiply' : 'normal'}
        />
      {/if}

      <circle cx={hand.at.x} cy={hand.at.y} r={DOT * unit} fill={hand.colour} />

      {#if named}
        <text
          x={hand.at.x + GAP * unit}
          y={hand.at.y - GAP * unit}
          fill={hand.colour}
          font-size="{LABEL * unit}px">{hand.name}</text
        >
      {/if}
    {/each}
  </svg>
{/if}

<style>
  /* Over the cards and the ink, because a hand is in front of the page it is
     drawing on, and out of the way of every pointer: the surface above owns them
     all. */
  .hands {
    position: absolute;
    left: 0;
    top: 0;
    pointer-events: none;
    z-index: 5;
  }

  text {
    font-family: var(--font-ui);
    font-weight: 550;
    transition: opacity 190ms ease;
  }
</style>
