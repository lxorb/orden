<script lang="ts">
  import ArrowLeft from 'lucide/dist/esm/icons/arrow-left.mjs'
  import { workspace } from '../workspace.svelte'
  import { swipeChoice } from './choice.svelte'
  import { swiping } from './shown.svelte'

  const { unseen }: { unseen: () => void } = $props()

  const seen = $derived(
    swipeChoice.on &&
      swiping.tab !== null &&
      swiping.pane !== null &&
      workspace.showing(swiping.pane)?.id === swiping.tab,
  )
  $effect(() => {
    if (swiping.tab !== null && !seen) unseen()
  })

  const EXTRA = 72
  const SIZE = 40

  const eased = (t: number) => 1 - (1 - t) ** 3

  const reach = $derived.by(() => {
    const progress = Math.max(0, swiping.progress)
    if (swiping.stage === 'stayed' || progress === 0) return 0
    const travel = Math.max(0, swiping.travel)
    if (progress <= 1) return travel
    const far = travel / progress
    return far + EXTRA * eased(Math.min(1, (travel - far) / (EXTRA * 3)))
  })

  const whole = (length: number) => {
    const ratio = window.devicePixelRatio || 1
    return Math.round(length * ratio) / ratio
  }

  const shift = $derived(
    swiping.side === 'left' ? reach - SIZE : (swiping.room?.width ?? 0) - reach,
  )

  const drop = $derived.by(() => {
    const room = swiping.room
    if (!room) return 0
    return whole(room.y + (room.height - SIZE) / 2) - room.y
  })
  const across = $derived(swiping.room ? whole(swiping.room.x + shift) - swiping.room.x : 0)

  const shade = $derived(swiping.stage === 'tracking' ? 1 : 0)

  const filled = $derived(Math.min(1, Math.max(0, swiping.progress)))
</script>

{#if swiping.room && seen}
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
  .track {
    position: fixed;
    z-index: var(--z-float);
    overflow: hidden;
    pointer-events: none;
  }

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
    will-change: transform, opacity;
  }

  .arrow {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .nib-swipe.right .arrow {
    transform: scaleX(-1);
  }

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

  .nib-swipe.armed {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }

  .nib-swipe.went {
    scale: 1.2;
    transition:
      opacity var(--dur-base) var(--ease-out),
      scale var(--dur-base) var(--ease-out),
      background-color var(--dur-base) var(--ease-out),
      color var(--dur-base) var(--ease-out),
      border-color var(--dur-base) var(--ease-out);
  }

  .went .ring {
    transition: opacity var(--dur-base) var(--ease-out);
  }

  .went .arrow {
    transition: scale var(--dur-base) var(--ease-out);
  }

  .nib-swipe.stayed {
    transition:
      transform var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
  }
</style>
