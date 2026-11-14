<script lang="ts">
  import {
    cleanLabel,
    PRIORITIES,
    PRIORITY_NAMES,
    type Priority,
    type Todo,
    type TodoPatch,
  } from '../../tasks-model/src/api'
  import type { Space } from './shown.svelte'

  const {
    todo,
    spaces,
    knownLabels,
    onchange,
    onremove,
    onclose,
  }: {
    todo: Todo
    spaces: readonly Space[]
    knownLabels: readonly string[]
    onchange: (patch: TodoPatch) => Promise<string | null>
    onremove: () => void
    onclose: () => void
  } = $props()

  let title = $state('')
  let description = $state('')
  let newLabel = $state('')
  let newSubtask = $state('')
  let refused = $state<string | null>(null)
  let seen = $state<string | null>(null)

  $effect(() => {
    if (seen === todo.id) return
    seen = todo.id
    title = todo.title
    description = todo.description
    refused = null
  })

  const suggestions = $derived(knownLabels.filter((one) => !todo.labels.includes(one)))

  async function change(patch: TodoPatch) {
    refused = await onchange(patch)
  }

  function saveTitle() {
    const next = title.trim()
    if (next === '') title = todo.title
    else if (next !== todo.title) void change({ title: next })
  }

  function saveDescription() {
    if (description !== todo.description) void change({ description })
  }

  function addLabel() {
    const label = cleanLabel(newLabel)
    newLabel = ''
    if (label === '' || todo.labels.includes(label)) return
    void change({ labels: [...todo.labels, label] })
  }

  function dropLabel(label: string) {
    void change({ labels: todo.labels.filter((one) => one !== label) })
  }

  function addSubtask() {
    const text = newSubtask.trim()
    newSubtask = ''
    if (text === '') return
    const id = `s${crypto.randomUUID().replace(/-/g, '').slice(0, 11)}`
    void change({ subtasks: [...todo.subtasks, { id, title: text, done: false }] })
  }

  function tickSubtask(id: string, done: boolean) {
    void change({ subtasks: todo.subtasks.map((one) => (one.id === id ? { ...one, done } : one)) })
  }

  function dropSubtask(id: string) {
    void change({ subtasks: todo.subtasks.filter((one) => one.id !== id) })
  }

  const dayOr = (value: string): string | null => (value === '' ? null : value)
</script>

<div class="editor" data-todo-editor={todo.id}>
  <div class="head">
    <input
      class="title"
      type="text"
      aria-label="Title"
      bind:value={title}
      onblur={saveTitle}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    />
    <button type="button" class="close" aria-label="Close" onclick={onclose}>Close</button>
  </div>

  <textarea
    class="description"
    aria-label="Description"
    placeholder="Description"
    rows="3"
    bind:value={description}
    onblur={saveDescription}></textarea>

  <div class="fields">
    <label>
      <span>Space</span>
      <select
        value={todo.space ?? ''}
        onchange={(event) => void change({ space: event.currentTarget.value || null })}
      >
        <option value="">No space</option>
        {#each spaces as space (space.id)}
          <option value={space.id}>{space.name}</option>
        {/each}
        {#if todo.space !== null && !spaces.some((one) => one.id === todo.space)}
          <option value={todo.space}>{todo.space}</option>
        {/if}
      </select>
    </label>
    <label>
      <span>Start date</span>
      <input
        type="date"
        value={todo.start ?? ''}
        onchange={(event) => void change({ start: dayOr(event.currentTarget.value) })}
      />
    </label>
    <label>
      <span>Deadline</span>
      <input
        type="date"
        value={todo.deadline ?? ''}
        onchange={(event) => void change({ deadline: dayOr(event.currentTarget.value) })}
      />
    </label>
    <label>
      <span>Priority</span>
      <select
        value={String(todo.priority)}
        onchange={(event) =>
          void change({ priority: Number(event.currentTarget.value) as Priority })}
      >
        {#each PRIORITIES as priority (priority)}
          <option value={String(priority)}>{PRIORITY_NAMES[priority]}</option>
        {/each}
      </select>
    </label>
  </div>

  <div class="labels">
    <span class="name">Labels</span>
    <div class="chips">
      {#each todo.labels as label (label)}
        <span class="chip">
          {label}
          <button type="button" aria-label="Remove label {label}" onclick={() => dropLabel(label)}>
            Remove
          </button>
        </span>
      {/each}
      <input
        class="new"
        type="text"
        list="todo-labels-{todo.id}"
        placeholder="Add label"
        aria-label="Add label"
        bind:value={newLabel}
        onblur={addLabel}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            addLabel()
          }
        }}
      />
      <datalist id="todo-labels-{todo.id}">
        {#each suggestions as label (label)}
          <option value={label}></option>
        {/each}
      </datalist>
    </div>
  </div>

  <div class="subtasks">
    <span class="name">Subtasks</span>
    <ul>
      {#each todo.subtasks as subtask (subtask.id)}
        <li class:done={subtask.done}>
          <input
            type="checkbox"
            aria-label="Done"
            checked={subtask.done}
            onchange={(event) => tickSubtask(subtask.id, event.currentTarget.checked)}
          />
          <span>{subtask.title}</span>
          <button type="button" aria-label="Remove subtask" onclick={() => dropSubtask(subtask.id)}>
            Remove
          </button>
        </li>
      {/each}
    </ul>
    <input
      class="new"
      type="text"
      placeholder="Add subtask"
      aria-label="Add subtask"
      bind:value={newSubtask}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          addSubtask()
        }
      }}
    />
  </div>

  {#if refused}
    <p class="refused" role="alert">{refused}</p>
  {/if}

  <div class="foot">
    <button type="button" class="danger" onclick={onremove}>Delete todo</button>
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .head {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  .title {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) 0;
    border: none;
    border-bottom: 1px solid var(--line);
    background: none;
    color: var(--text-strong);
    font: inherit;
    font-weight: var(--weight-strong);
  }

  .description,
  .new,
  select,
  input[type='date'] {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .description {
    resize: vertical;
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-2);
  }

  .fields label,
  .labels,
  .subtasks {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .fields span,
  .name {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
  }

  .chip {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    font-size: var(--text-sm);
  }

  .chip button,
  li button,
  .close {
    padding: 0 var(--space-1);
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
  }

  .chip button:hover,
  li button:hover,
  .close:hover {
    color: var(--text-strong);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  li span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  li.done span {
    color: var(--muted);
    text-decoration: line-through;
  }

  .refused {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
  }

  .foot {
    display: flex;
    justify-content: flex-end;
  }

  .danger {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: none;
    color: var(--danger);
    font: inherit;
    font-size: var(--text-sm);
  }
</style>
