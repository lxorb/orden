<script lang="ts">
  import { onDestroy } from 'svelte'
  import { keyElsewhere } from '../layer-keys'
  import { shortcuts } from '../shortcuts.svelte'
  import { arrive } from '../slide'
  import { workspace } from '../workspace.svelte'
  import AddRow from './AddRow.svelte'
  import BoardLayout from './BoardLayout.svelte'
  import CardsLayout from './CardsLayout.svelte'
  import ChartLayout from './ChartLayout.svelte'
  import { ghostOwner } from './drag.svelte'
  import DragGhost from './DragGhost.svelte'
  import type { Kit } from './kit'
  import FormLayout from './FormLayout.svelte'
  import TableLayout from './TableLayout.svelte'
  import TimelineLayout from './TimelineLayout.svelte'
  import ViewHead from './ViewHead.svelte'
  import { layoutOf } from './words'

  const { kit, title }: { kit: Kit; title: string } = $props()

  const live = $derived(kit.live)
  const layout = $derived(layoutOf(live.view?.type ?? 'table'))

  let adding = $state(false)
  let asked = $state(0)

  const ghost = ghostOwner()
  onDestroy(ghost.release)

  function keydown(event: KeyboardEvent & { currentTarget: HTMLElement }) {
    const target = event.target
    if (keyElsewhere(event, event.currentTarget)) return
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable]')
    )
      return
    if (shortcuts.pressed('edit.undo', event)) {
      event.preventDefault()
      void workspace.undoFileAction()
      return
    }
    if (shortcuts.pressed('edit.redo', event) || shortcuts.pressed('edit.redo.alt', event)) {
      event.preventDefault()
      void workspace.redoFileAction()
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (shortcuts.pressed('tasks.quick-add', event) && !event.defaultPrevented) {
      event.preventDefault()
      add()
    }
  }

  let boardAdding = $state(0)

  function add() {
    if (!kit.adds) return
    if (layout === 'kanban' && (live.view?.orden.rows ?? 'notes') === 'notes') {
      boardAdding++
      return
    }
    adding = true
    asked++
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="frame" class:compact={kit.compact} onkeydown={keydown}>
  <ViewHead {kit} {title} onadd={add} />
  {#if adding}
    <div class="adding"><AddRow {kit} {asked} onclose={() => (adding = false)} /></div>
  {/if}

  {#if live.failed}
    <p class="empty">This base cannot be read</p>
  {:else}
    {#if live.answer?.partial}
      <p class="partial" role="status">{title} took too long to answer.</p>
    {/if}
    {#key layout}
      <div
        class="body"
        class:fills={layout === 'kanban' || layout === 'timeline'}
        in:arrive
      >
        {#if layout === 'table'}
          <TableLayout {kit} />
        {:else if layout === 'cards'}
          <CardsLayout {kit} />
        {:else if layout === 'kanban'}
          <BoardLayout {kit} adding={boardAdding} />
        {:else if layout === 'timeline'}
          <TimelineLayout {kit} />
        {:else if layout === 'form'}
          <FormLayout {kit} />
        {:else}
          <ChartLayout {kit} />
        {/if}
      </div>
    {/key}
  {/if}
</div>

{#if ghost.mine()}
  <DragGhost />
{/if}

<style>
  .frame {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    color: var(--text);
  }

  .frame.compact {
    height: auto;
    max-height: 560px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .adding {
    padding: var(--space-1) var(--space-2) 0;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .body.fills {
    overflow: hidden;
  }

  .compact .body.fills {
    height: 420px;
  }

  .partial {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    color: var(--muted-strong);
    font-size: var(--text-xs);
  }

  .empty {
    margin: var(--space-4);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }
</style>
