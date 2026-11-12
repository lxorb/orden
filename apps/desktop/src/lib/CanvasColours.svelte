<script lang="ts">
  import { DOTS } from './canvas/palette'
  import { tick } from './canvas/tick'

  const {
    colour,
    recent = [],
    none = true,
    bare,
    wheel = true,
    oncolour,
  }: {
    colour: string | null
    recent?: readonly string[]
    none?: boolean
    bare?: { css: string; title: string }
    wheel?: boolean
    oncolour: (colour: string | null) => void
  } = $props()

  function choose(next: string | null) {
    tick()
    oncolour(next)
  }
</script>

<div class="colours">
  {#each DOTS as dot (dot.colour)}
    <button
      type="button"
      class="dot"
      class:on={colour === dot.colour}
      title="Colour {dot.colour}"
      aria-label="Colour {dot.colour}"
      aria-pressed={colour === dot.colour}
      style:--dot={dot.css}
      onclick={() => choose(dot.colour)}
    ></button>
  {/each}

  {#if none}
    <button
      type="button"
      class="dot"
      class:bare={!bare}
      class:on={colour === null}
      title={bare?.title ?? 'No colour'}
      aria-label={bare?.title ?? 'No colour'}
      aria-pressed={colour === null}
      style:--dot={bare?.css}
      onclick={() => choose(null)}
    ></button>
  {/if}

  {#if wheel}
    <label class="dot wheel" title="Another colour">
      <input
        type="color"
        value={colour?.startsWith('#') ? colour : '#7c5cff'}
        aria-label="Another colour"
        oninput={(event) => choose(event.currentTarget.value)}
      />
    </label>
  {/if}

  {#each recent as one (one)}
    <button
      type="button"
      class="dot"
      class:on={colour === one}
      title="The colour you used before"
      aria-label="The colour you used before"
      aria-pressed={colour === one}
      style:--dot={one}
      onclick={() => choose(one)}
    ></button>
  {/each}
</div>

<style>
  .colours {
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 40px));
    gap: 2px;
  }

  .dot {
    display: grid;
    place-items: center;
    width: 100%;
    height: 40px;
    padding: 0;
    border: none;
    background: none;
    cursor: default;
  }

  .dot::after {
    content: '';
    display: block;
    width: min(26px, 100%);
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--dot);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent);
    transition:
      scale var(--dur-fast) var(--ease-spring),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .dot:hover::after {
    scale: 1.12;
  }

  .dot:active::after {
    scale: 1.04;
  }

  .dot.on::after {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  .bare::after {
    background: none;
    box-shadow: inset 0 0 0 2px var(--muted);
  }

  .bare.on::after {
    box-shadow:
      inset 0 0 0 2px var(--muted),
      0 0 0 2px var(--surface),
      0 0 0 4px var(--accent);
  }

  .wheel {
    position: relative;
    overflow: hidden;
    cursor: pointer;
  }

  .wheel::after {
    background: conic-gradient(
      from 0deg,
      var(--canvas-1),
      var(--canvas-2),
      var(--canvas-3),
      var(--canvas-4),
      var(--canvas-5),
      var(--canvas-6),
      var(--canvas-1)
    );
  }

  .wheel input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    opacity: 0;
    cursor: pointer;
  }
</style>
