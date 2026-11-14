<script lang="ts">
  import { CanvasColours } from '../../ui-controls/src/api'
  import { overlays } from '../../ui-kit/src/api'
  import { toneColour } from './chips'

  const { tone, ontone }: { tone: string | undefined; ontone: (tone: string | null) => void } =
    $props()

  let open = $state(false)
  let host = $state<HTMLElement>()
  const colour = $derived(toneColour(tone))

  $effect(() =>
    open
      ? overlays.show(
          () => (open = false),
          () => [host],
        )
      : undefined,
  )
</script>

<span class="tone" bind:this={host}>
  <button
    type="button"
    class="dot"
    class:none={colour === null}
    style:--dot={colour}
    title="Colour"
    aria-label="Colour"
    aria-expanded={open}
    onclick={() => (open = !open)}
  ></button>
  {#if open}
    <span class="pick orden-layer">
      <CanvasColours
        colour={tone ?? null}
        wheel={false}
        oncolour={(next: string | null) => {
          open = false
          ontone(next)
        }}
      />
    </span>
  {/if}
</span>

<style>
  .tone {
    position: relative;
    display: inline-grid;
    place-items: center;
  }

  .dot {
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition: scale var(--dur-fast) var(--ease-spring);
  }

  .dot.none {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--muted);
  }

  .dot:hover {
    scale: 1.12;
  }

  .pick {
    position: absolute;
    top: calc(100% + 4px);
    inset-inline-start: 0;
    z-index: var(--z-popover);
    padding: var(--space-1);
  }
</style>
