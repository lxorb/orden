<script lang="ts">
  /** The arrow a swipe brings in from the side of a pane: Chrome's, in nib's own
   *  colours. A circle with an arrow in it slides in with the fingers, pixel for pixel,
   *  from behind the side to where letting go would go, and past that a little further
   *  against a growing pull, so it stops. A ring round its edge fills with the accent as
   *  the fingers go, so how far is left is in sight; full, the circle fills with it, the
   *  arrow in it gives one small push, and letting go goes. Nothing happens while the
   *  fingers are down. It bursts once and goes when the swipe goes, and slides back out
   *  when it stays. While the fingers are on it never glides: where it is drawn is where
   *  they are. See swipes.ts, and gesture_nav_simple.cc in Chromium for the look.
   *
   *  Over a web tab the page is a webview drawn above every pixel of the window. While
   *  the fingers are on, the whole pane counts as covered (`nib-swipe-room`, which
   *  covers.ts takes for a scrim): the page stands as its still picture and the arrow is
   *  drawn over it whole, shadow and soft edge and all. It used to be cut out of the page
   *  in its own shape, and a window's shape on Windows is whole pixels with no soft edge,
   *  set again on every step: a jagged circle that lagged the fingers (#209). Until the
   *  picture is in, and while the arrow bursts on its way out, it is cut round as before.
   *
   *  Where it is drawn is whole pixels of the screen, so the circle, its ring and the
   *  arrow are drawn sharp at 125 and 150 per cent as well as at 100 and 200. */
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import { swiping } from './shown.svelte'

  /** How much further than where letting go goes the circle may be pulled. */
  const EXTRA = 72
  /** The circle's diameter. */
  const SIZE = 40

  /** Chrome's fast-out-slow-in, for the stretch past the threshold. */
  const eased = (t: number) => 1 - (1 - t) ** 3

  /** How far in from the side the circle's leading edge is: the fingers' own travel up
   *  to where letting go goes, and past it a pull that gives a little less each pixel. */
  const reach = $derived.by(() => {
    const progress = Math.max(0, swiping.progress)
    if (swiping.stage === 'stayed' || progress === 0) return 0
    const travel = Math.max(0, swiping.travel)
    if (progress <= 1) return travel
    const far = travel / progress
    return far + EXTRA * eased(Math.min(1, (travel - far) / (EXTRA * 3)))
  })

  /** A length in the window's pixels, on the nearest whole pixel of the screen. */
  const whole = (length: number) => {
    const ratio = window.devicePixelRatio || 1
    return Math.round(length * ratio) / ratio
  }

  const shift = $derived(
    swiping.side === 'left' ? reach - SIZE : (swiping.room?.width ?? 0) - reach,
  )

  /** Where the circle's corner is in the room, put on a whole pixel of the screen counted
   *  from the window's corner rather than the room's, which is on one only by chance:
   *  across with the fingers, and half way down. */
  const drop = $derived.by(() => {
    const room = swiping.room
    if (!room) return 0
    return whole(room.y + (room.height - SIZE) / 2) - room.y
  })
  const across = $derived(swiping.room ? whole(swiping.room.x + shift) - swiping.room.x : 0)

  /** Faded in over the first third of the way, and out as it plays out. */
  const shade = $derived(swiping.stage === 'tracking' ? Math.min(1, swiping.progress * 3) : 0)

  /** How much of the ring is filled: the way to where letting go goes. */
  const filled = $derived(Math.min(1, Math.max(0, swiping.progress)))
</script>

{#if swiping.room}
  <div
    class="track"
    class:nib-swipe-room={swiping.stage !== 'went'}
    style:left="{swiping.room.x}px"
    style:top="{swiping.room.y}px"
    style:width="{swiping.room.width}px"
    style:height="{swiping.room.height}px"
    aria-hidden="true"
  >
    <div
      class="nib-swipe"
      class:armed={swiping.progress >= 1 || swiping.stage === 'went'}
      class:went={swiping.stage === 'went'}
      class:stayed={swiping.stage === 'stayed'}
      class:tracking={swiping.stage === 'tracking'}
      class:right={swiping.side === 'right'}
      style:transform="translate({across}px, {drop}px)"
      style:opacity={shade}
    >
      <svg class="ring" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r="18" pathLength="1" style:stroke-dashoffset={1 - filled} />
      </svg>
      <svg class="arrow" viewBox="0 0 24 24">
        {#each ArrowLeft as [tag, attrs], index (index)}
          <svelte:element this={tag} {...attrs} />
        {/each}
      </svg>
    </div>
  </div>
{/if}

<style>
  /* The pane's content, which the circle is clipped to: it comes in from beyond the
     side, never from over the file list. */
  .track {
    position: fixed;
    z-index: var(--z-float);
    overflow: hidden;
    pointer-events: none;
  }

  /* Chrome's forty pixels. The corner is half of it in pixels rather than a
     percentage, because it is also the shape the page is cut in; see covers.ts. */
  .nib-swipe {
    --size: 40px;
    position: absolute;
    top: 0;
    left: 0;
    display: grid;
    place-items: center;
    width: var(--size);
    height: var(--size);
    border: 1px solid var(--line-strong);
    border-radius: calc(var(--size) / 2);
    background: var(--surface-3);
    box-shadow: var(--shadow-md);
    color: var(--accent);
    /* Moved and faded by the compositor on every step, never painted again for it. */
    will-change: transform, opacity;
    transition:
      transform var(--dur-instant) var(--ease-out),
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  /* The icon's own twenty-four, on its own grid: eight pixels in from the circle's edge,
     which is whole pixels of the screen at 125 and 150 per cent as well, where twenty
     put it half a pixel off and drew its two-pixel lines between pixels. */
  .arrow {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  /* With the fingers: drawn where they are, never on its way there. */
  .nib-swipe.tracking {
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .nib-swipe.right .arrow {
    transform: scaleX(-1);
  }

  /* The way to where letting go goes, filled from the top towards the side the arrow
     points. Inside the circle, so the shape a page is cut in stays the circle's. */
  /* Over the border box, which the view box is the size of: from inside the border it
     was drawn at 38/40ths, its stroke and its circle between pixels. */
  .ring {
    position: absolute;
    inset: -1px;
    width: calc(100% + 2px);
    height: calc(100% + 2px);
    transform: rotate(-90deg) scaleY(-1);
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-dasharray: 1;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .nib-swipe.right .ring {
    transform: rotate(-90deg);
  }

  .armed .ring {
    opacity: 0;
  }

  .armed .arrow {
    scale: 1.15;
  }

  /* Past the point where letting go goes: the circle takes the accent, as Chrome's
     turns blue. */
  .nib-swipe.armed {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }

  /* Gone: one burst, and out. */
  .nib-swipe.went {
    scale: 1.2;
    transition:
      opacity var(--dur-base) var(--ease-out),
      scale var(--dur-base) var(--ease-out);
  }

  /* Stayed: back out the way it came. */
  .nib-swipe.stayed {
    transition:
      transform var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
  }
</style>
