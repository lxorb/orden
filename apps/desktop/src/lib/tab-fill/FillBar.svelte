<script lang="ts">
  import { onDestroy, type Snippet, tick, untrack } from 'svelte'
  import { GRACE } from '../edge-peek.svelte'
  import { focusEditor } from '../focus'
  import { overlays } from '../ui-kit/src/api'
  import { workspace } from '../workspace.svelte'
  import { chromeComes } from './chrome'
  import { unfill } from './fill'
  import { atEdge, escapeLeaves, mayHide, stillFills } from './rules'

  const { children }: { children: Snippet } = $props()

  const GOES_AFTER = GRACE

  let shown = $state(false)
  let pointer = false
  let keyboard = false
  let within = false
  let bar = $state<HTMLElement>()

  let going: ReturnType<typeof setTimeout> | undefined

  const lights = document.documentElement.hasAttribute('data-lights')

  function moved(y: number) {
    if (shown) {
      pointer = y >= 0 && y < (bar?.getBoundingClientRect().bottom ?? 0)
      if (pointer) hold()
      else letGo()
      return
    }

    if (!atEdge(y)) return
    shown = true
    pointer = true
  }

  function letGo() {
    going ??= setTimeout(() => {
      going = undefined
      if (mayHide({ pointer, keyboard, layers: overlays.depth })) shown = false
    }, GOES_AFTER)
  }

  function hold() {
    clearTimeout(going)
    going = undefined
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return

    const holder = document.activeElement
    queueMicrotask(() => {
      if (!event.defaultPrevented && escapeLeaves(holder)) unfill()
    })
  }

  $effect(() => {
    const panes = workspace.panes
    const holds = stillFills({
      fills: panes.fills,
      focusedId: panes.focusedId,
      showing: panes.focused.activeTabId,
    })
    if (!holds) untrack(unfill)
  })

  $effect(() =>
    overlays.watch(() => {
      if (shown && overlays.depth === 0) letGo()
    }),
  )

  onDestroy(() => {
    clearTimeout(going)
    const stranded = within
    void tick().then(() => {
      chromeComes()
      if (stranded) focusEditor()
    })
  })
</script>

<svelte:window
  onpointermove={(event: PointerEvent) => moved(event.clientY)}
  onkeydown={onKeydown}
/>

{#if lights}
  <div class="lights" data-tauri-drag-region></div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="bar"
  class:shown
  data-covers
  inert={!shown}
  bind:this={bar}
  onpointerleave={() => {
    pointer = false
    letGo()
  }}
  onfocusin={(event: FocusEvent) => {
    within = true
    keyboard = event.target instanceof Element && event.target.matches(':focus-visible')
    if (keyboard) hold()
  }}
  onfocusout={() => {
    within = false
    keyboard = false
    letGo()
  }}
>
  {@render children()}
</div>

<style>
  .bar {
    position: absolute;
    inset: 0 0 auto;
    z-index: var(--z-float);
    transform: translateY(-100%);
    visibility: hidden;
    transition:
      transform var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      visibility 0s linear var(--dur-fast);
  }

  .bar.shown {
    transform: none;
    visibility: visible;
    box-shadow: var(--shadow-md);
    transition:
      transform var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .lights {
    flex: none;
    height: var(--titlebar-height);
  }
</style>
