<script lang="ts">
  import { alone } from './alone.svelte'
  import { steppedKey } from './direction'
  import { t } from './i18n.svelte'
  import Pane from './Pane.svelte'
  import PaneTree from './PaneTree.svelte'
  import { clamped, type Frame, paneIn, type Split, tracks } from './workspace/pane-tree'
  import { workspace } from './workspace.svelte'

  const { frame }: { frame: Frame } = $props()

  const split = $derived(frame.kind === 'split' ? frame : null)

  const kept = $derived.by(() => {
    const fills = workspace.panes.fills ?? alone.pane
    return split && fills ? split.sides.findIndex((side) => paneIn(side, fills)) : -1
  })

  let host = $state<HTMLElement>()
  let wide = $state(0)
  let tall = $state(0)

  function ends(split: Split): [number, number] {
    const room = split.along === 'row' ? wide : tall
    if (!room) return [0, 100]
    return [Math.round(clamped(0, room) * 100), Math.round(clamped(1, room) * 100)]
  }

  let dragging: (() => void) | null = null

  $effect(() => () => dragging?.())

  function grab(event: PointerEvent & { currentTarget: HTMLElement }, split: Split) {
    if (event.button !== 0 || !host) return

    const handle = event.currentTarget
    const box = host.getBoundingClientRect()
    const along = split.along

    handle.setPointerCapture(event.pointerId)
    workspace.panes.sliding = split.id
    document.body.style.cursor = along === 'row' ? 'col-resize' : 'row-resize'
    document.body.classList.add('nib-unselectable')

    const move = (moved: PointerEvent) => {
      const room = along === 'row' ? box.width : box.height
      const at = along === 'row' ? moved.clientX - box.left : moved.clientY - box.top
      workspace.panes.resize(split.id, at / room, room)
    }

    const stop = () => {
      if (!dragging) return
      dragging = null

      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', stop)
      handle.removeEventListener('pointercancel', stop)

      document.body.style.cursor = ''
      document.body.classList.remove('nib-unselectable')
      workspace.panes.settle()
    }

    dragging = stop
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', stop)
    handle.addEventListener('pointercancel', stop)
  }

  const STEP = 0.05

  function nudge(event: KeyboardEvent, split: Split) {
    if (!host) return
    const row = split.along === 'row'
    const to = {
      Home: 0,
      End: 1,
      [row ? 'ArrowLeft' : 'ArrowUp']: split.fraction - STEP,
      [row ? 'ArrowRight' : 'ArrowDown']: split.fraction + STEP,
    }[steppedKey(event.key)]

    if (event.key === 'Enter' || event.key === ' ') workspace.panes.equalise(split.id)
    else if (to === undefined) return
    else {
      const box = host.getBoundingClientRect()
      workspace.panes.resize(split.id, to, row ? box.width : box.height)
      workspace.panes.settle()
    }
    event.preventDefault()
  }
</script>

{#if split}
  <div
    class="split"
    class:down={split.along === 'column'}
    class:sliding={workspace.panes.sliding === split.id}
    bind:this={host}
    bind:clientWidth={wide}
    bind:clientHeight={tall}
    style:grid-template-columns={split.along === 'row' && kept < 0 ? tracks(split) : undefined}
    style:grid-template-rows={split.along === 'column' && kept < 0 ? tracks(split) : undefined}
  >
    {#each split.sides as side, at (side.id)}
      {#if at === 1 && kept < 0}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="divider"
          role="separator"
          aria-orientation={split.along === 'row' ? 'vertical' : 'horizontal'}
          aria-label={t('Pane size')}
          aria-valuemin={ends(split)[0]}
          aria-valuemax={ends(split)[1]}
          aria-valuenow={Math.round(split.fraction * 100)}
          tabindex="0"
          title={t('Drag to resize')}
          onpointerdown={(event) => grab(event, split)}
          ondblclick={() => workspace.panes.equalise(split.id)}
          onkeydown={(event) => nudge(event, split)}
        ></div>
      {/if}

      {#if kept < 0 || kept === at}
        <div class="side"><PaneTree frame={side} /></div>
      {/if}
    {/each}
  </div>
{:else if frame.kind === 'pane'}
  <Pane pane={frame} />
{/if}

<style>
  .split {
    display: grid;
    flex: 1;
    min-width: 0;
    min-height: 0;
    transition:
      grid-template-columns var(--dur-base) var(--ease-out),
      grid-template-rows var(--dur-base) var(--ease-out);
  }

  .split.sliding {
    transition: none;
  }

  .side {
    display: flex;
    min-width: 0;
    min-height: 0;
  }

  .divider {
    position: relative;
    background: var(--chrome-seam) center / 2px 100% no-repeat;
    background-image: linear-gradient(
      var(--divider-lit, transparent),
      var(--divider-lit, transparent)
    );
    transition: background-color var(--dur-fast) var(--ease-out);
  }

  .split.down > .divider {
    background-size: 100% 2px;
  }

  .divider::after {
    content: '';
    position: absolute;
    inset: 0 -3px;
    cursor: col-resize;
  }

  .split.down > .divider::after {
    inset: -3px 0;
    cursor: row-resize;
  }

  .divider:hover,
  .divider:focus-visible,
  .split.sliding > .divider {
    --divider-lit: var(--accent);
  }
</style>
