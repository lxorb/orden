<script lang="ts">
  import { onMount } from 'svelte'
  import ExplorerPreview from './ExplorerPreview.svelte'
  import type { ExplorerView } from './view.svelte'

  const { view, onclose }: { view: ExplorerView; onclose: () => void } = $props()

  let box = $state<HTMLElement>()

  onMount(() => {
    box?.focus()
  })

  function step(by: number) {
    const at = view.picked.cursor === null ? -1 : view.names.indexOf(view.picked.cursor)
    const name = view.names[Math.min(view.names.length - 1, Math.max(0, at + by))]
    if (name !== undefined) view.pick(name, 'one')
  }

  function onkey(event: KeyboardEvent) {
    const key = event.key
    if (event.key === 'Escape' || event.key === ' ') onclose()
    else if (key === 'ArrowRight' || key === 'ArrowDown') step(1)
    else if (key === 'ArrowLeft' || key === 'ArrowUp') step(-1)
    else return
    event.preventDefault()
    event.stopPropagation()
  }
</script>

<div
  class="look"
  role="dialog"
  aria-modal="true"
  aria-label="Preview"
  tabindex="-1"
  bind:this={box}
  onkeydown={onkey}
>
  <ExplorerPreview {view} large />
</div>

<style>
  .look {
    position: absolute;
    inset: var(--space-4);
    z-index: var(--z-raised);
    display: flex;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
</style>
