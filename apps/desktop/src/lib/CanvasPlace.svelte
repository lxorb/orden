<script lang="ts">
  /** What a press puts on the plane: a card, a note or a picture, a link, a frame,
   *  and the four shapes.
   *
   *  Eight things behind one button rather than eight buttons on the bar. A hand
   *  that is drawing never wants any of them, and a hand that is arranging wants
   *  one at a time, so the bar keeps the room for the pens. Each is a mark and the
   *  word for it, laid out the way the pen's own kinds are, and the hover says
   *  which key does it: this panel is where somebody stops using it. */

  import CanvasIcon from './CanvasIcon.svelte'
  import { hinted, PLACING } from './canvas/glyphs'
  import { type Tool } from './canvas/pointer'
  import { tick } from './canvas/tick'
  import { tools } from './canvas/tools.svelte'

  const { onchoose }: { onchoose: (tool: Tool) => void } = $props()
</script>

<div class="place">
  {#each PLACING as one (one.id)}
    <button
      type="button"
      class:on={tools.which === one.id}
      title={hinted(one)}
      aria-label={one.title()}
      aria-pressed={tools.which === one.id}
      onclick={() => {
        tick()
        onchoose(one.id)
      }}
    >
      <CanvasIcon node={one.icon} />
      <span>{one.title()}</span>
    </button>
  {/each}
</div>

<style>
  .place {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
  }

  button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 34px;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
    transition:
      background var(--dur-instant) var(--ease-out),
      color var(--dur-instant) var(--ease-out);
  }

  button span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button:active {
    background: var(--press);
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  :global([data-touch]) button {
    --mark: var(--touch-icon);

    min-height: var(--touch-target);
    font-size: var(--touch-text);
  }
</style>
