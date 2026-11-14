<script lang="ts">
  import { PRIORITY_NAMES, type Todo } from '../../tasks-model/src/api'

  const {
    todo,
    today,
    open,
    showLabels = true,
    ontoggle,
    onopen,
  }: {
    todo: Todo
    today: string
    open: boolean
    showLabels?: boolean
    ontoggle: (done: boolean) => void
    onopen: () => void
  } = $props()

  const late = $derived(!todo.done && todo.deadline !== null && todo.deadline < today)
  const subtasksDone = $derived(todo.subtasks.filter((one) => one.done).length)
</script>

<div class="row" class:done={todo.done} class:open data-todo={todo.id}>
  <input
    class="tick"
    type="checkbox"
    aria-label="Done"
    checked={todo.done}
    onchange={(event) => ontoggle(event.currentTarget.checked)}
  />
  <button type="button" class="body" onclick={onopen}>
    <span class="title">
      {#if todo.priority > 0}
        <span class="priority p{todo.priority}" title={PRIORITY_NAMES[todo.priority]}></span>
      {/if}
      {todo.title}
    </span>
    {#if todo.deadline !== null || todo.subtasks.length || (showLabels && todo.labels.length)}
      <span class="meta">
        {#if todo.deadline !== null}
          <span class="deadline" class:late>{todo.deadline}</span>
        {/if}
        {#if todo.subtasks.length}
          <span class="subtasks">{subtasksDone} of {todo.subtasks.length}</span>
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
  .row {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-row);
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .row.open {
    background: var(--surface-selected);
  }

  .tick {
    flex: none;
    margin-top: 0.3em;
  }

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
    text-align: start;
  }

  .done .title {
    color: var(--muted);
    text-decoration: line-through;
  }

  .title {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    overflow-wrap: anywhere;
  }

  .priority {
    flex: none;
    width: 0.5em;
    height: 0.5em;
    border-radius: 50%;
    background: var(--muted);
  }

  .priority.p2 {
    background: var(--accent);
  }

  .priority.p3 {
    background: var(--danger);
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .late {
    color: var(--danger);
  }

  .label {
    padding: 0 var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }
</style>
