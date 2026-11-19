<script lang="ts">
  import { PRIORITY_NAMES, type Todo } from '../../tasks-model/src/api'
  import { dayWords } from '../../ui-controls/src/api'
  import { longPress } from '../../ui-kit/src/api'
  import { rowMenu } from './rows.svelte'
  import { swipeAway } from './swipe-away'

  const {
    todo,
    today,
    open,
    showLabels = true,
    picked = false,
    ontoggle,
    onopen,
    onpick = () => false,
    onmenu,
    onaway,
  }: {
    todo: Todo
    today: string
    open: boolean
    showLabels?: boolean
    picked?: boolean
    ontoggle: (done: boolean) => void
    onopen: () => void
    onpick?: (event: MouseEvent) => boolean
    onmenu?: (event: MouseEvent) => void
    onaway?: () => void
  } = $props()
  const late = $derived(!todo.done && todo.deadline !== null && todo.deadline < today)
  const subtasksDone = $derived(todo.subtasks.filter((one) => one.done).length)
  const TONES: Readonly<Record<number, string>> = { 2: 'var(--callout-warning)', 3: 'var(--danger)' }
  const tone = $derived(TONES[todo.priority])
</script>

<div
  class="todo orden-row"
  class:is-on={open}
  class:is-picked={picked && !open}
  class:done={todo.done}
  data-todo={todo.id}
  use:rowMenu={(event: MouseEvent) => onmenu?.(event)}
  use:longPress={(event) => onmenu?.(event)}
  use:swipeAway={() => onaway?.()}
>
  <input
    class="tick orden-checkbox"
    type="checkbox"
    aria-label="Done"
    checked={todo.done}
    style:--tone={tone}
    class:toned={tone !== undefined}
    onchange={(event) => ontoggle(event.currentTarget.checked)}
  />
  <button
    type="button"
    class="body"
    aria-expanded={open}
    onclick={(event) => {
      if (!onpick(event)) onopen()
    }}
  >
    <span class="title">{todo.title}</span>
    {#if picked}<span class="orden-said">Selected</span>{/if}
    {#if todo.priority > 0 || todo.deadline !== null || todo.subtasks.length || (showLabels && todo.labels.length)}
      <span class="meta">
        {#if todo.priority > 0}
          <span class="priority" style:--tone={tone}>{PRIORITY_NAMES[todo.priority]}</span>
        {/if}
        {#if todo.deadline !== null}
          <span class="deadline" class:late>
            <svg viewBox="0 0 16 16" aria-hidden="true"
              ><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg
            >{dayWords(todo.deadline, today)}</span
          >
        {/if}
        {#if todo.subtasks.length}
          <span class="subtasks">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3L13 5" /></svg>{subtasksDone}/{todo.subtasks
              .length}</span
          >
        {/if}
        {#if showLabels}
          {#each todo.labels as label (label)}
            <span class="label">{label}</span>
          {/each}
        {/if}
      </span>
    {/if}
  </button>
</div>

<style>
  .todo {
    touch-action: pan-y;
    transition:
      translate var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
    align-items: flex-start;
    gap: var(--space-2);
    padding-block: 5px;
  }
  .tick {
    flex: none;
    margin: 3px 0 0;
  }
  .is-on .tick:not(:checked) {
    border-color: var(--muted);
  }
  .tick.toned:not(:checked) {
    border-color: var(--tone);
  }
  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }
  .title {
    color: var(--text-strong);
    overflow-wrap: anywhere;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .done .title {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px var(--space-2);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-row);
  }
  .meta > span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .meta svg {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .priority {
    color: var(--tone, var(--muted));
  }
  .late {
    color: var(--danger);
  }
  .label {
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: 99px;
    color: var(--muted-strong);
  }
</style>
