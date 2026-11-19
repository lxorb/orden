<script lang="ts">
  import { untrack } from 'svelte'
  import {
    cleanLabel,
    isTodoSpace,
    PRIORITIES,
    PRIORITY_NAMES,
    type Priority,
    type Todo,
    type TodoPatch,
  } from '../../tasks-model/src/api'
  import { DateField, Select } from '../../ui-controls/src/api'
  import { Cross } from '../../ui-kit/src/api'
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
  const inSpace = $derived(spaces.find((one) => isTodoSpace(one, todo.space)) ?? null)
  let title = $state('')
  let description = $state('')
  let newLabel = $state('')
  let newSubtask = $state('')
  let refused = $state<string | null>(null)
  let seen = $state<string | null>(null)
  let titleFrom = ''
  let descriptionFrom = ''
  $effect(() => {
    const id = todo.id
    const nextTitle = todo.title
    const nextDescription = todo.description
    const fresh = seen !== id
    if (fresh) {
      seen = id
      refused = null
    }
    untrack(() => {
      if (fresh || title === titleFrom) title = nextTitle
      if (fresh || description === descriptionFrom) description = nextDescription
    })
    titleFrom = nextTitle
    descriptionFrom = nextDescription
  })
  let labeling = $state(false)
  const suggestions = $derived(
    knownLabels
      .filter((one) => !todo.labels.includes(one) && one.toLowerCase().includes(newLabel.trim().toLowerCase()))
      .slice(0, 8),
  )
  const subtasksDone = $derived(todo.subtasks.filter((one) => one.done).length)
  async function change(patch: TodoPatch) {
    refused = await onchange(patch)
  }
  function saveTitle() {
    const next = title.trim()
    title = next === '' ? todo.title : next
    if (next !== '' && next !== todo.title) void change({ title: next })
  }
  function saveDescription() {
    if (description !== todo.description) void change({ description })
  }
  function addLabel(typed = newLabel) {
    const label = cleanLabel(typed)
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
  function fitting(field: HTMLTextAreaElement, _words: string) {
    const fit = () => {
      field.style.height = 'auto'
      field.style.height = `${String(field.scrollHeight + 2)}px`
    }
    fit()
    field.addEventListener('input', fit)
    return { update: fit, destroy: () => field.removeEventListener('input', fit) }
  }
</script>

<div class="editor" data-todo-editor={todo.id}>
  <div class="head">
    <input
      class="title orden-title-field"
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
    <button type="button" class="close orden-glyph" aria-label="Close" title="Close" onclick={onclose}>
      <Cross />
    </button>
  </div>

  <textarea
    class="description orden-title-field is-body"
    aria-label="Description"
    placeholder="Add a description"
    rows="2"
    bind:value={description}
    use:fitting={description}
    onblur={saveDescription}></textarea>

  <div class="fields">
    <div class="field">
      <span class="name">Space</span>
      <Select
        label="Space"
        value={inSpace?.id ?? todo.space ?? ''}
        options={[
          { value: '', label: 'No space' },
          ...spaces.map((space) => ({ value: space.id, label: space.name })),
          ...(todo.space !== null && inSpace === null ? [{ value: todo.space, label: todo.space }] : []),
        ]}
        onchange={(next: string) => void change({ space: next || null })}
      />
    </div>
    <div class="field">
      <span class="name">Priority</span>
      <Select
        label="Priority"
        value={String(todo.priority)}
        options={PRIORITIES.map((priority) => ({ value: String(priority), label: PRIORITY_NAMES[priority] }))}
        onchange={(next: string) => void change({ priority: Number(next) as Priority })}
      />
    </div>
    <div class="field">
      <span class="name">Start date</span>
      <DateField
        label="Start date"
        value={todo.start ?? ''}
        onchange={(next: string) => void change({ start: dayOr(next) })}
      />
    </div>
    <div class="field">
      <span class="name">Deadline</span>
      <DateField
        label="Deadline"
        value={todo.deadline ?? ''}
        onchange={(next: string) => void change({ deadline: dayOr(next) })}
      />
    </div>
  </div>

  <div class="group">
    <p class="orden-section">Labels</p>
    <div class="chips">
      {#each todo.labels as label (label)}
        <span class="chip">
          <span class="word">{label}</span>
          <button
            type="button"
            class="off"
            aria-label="Remove label {label}"
            title="Remove"
            onclick={() => dropLabel(label)}
          >
            <Cross small />
          </button>
        </span>
      {/each}
      <input
        class="new orden-title-field"
        type="text"
        placeholder="Add label"
        aria-label="Add label"
        bind:value={newLabel}
        onfocus={() => (labeling = true)}
        onblur={() => {
          labeling = false
          addLabel()
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            addLabel()
          }
        }}
      />
    </div>
    {#if labeling && suggestions.length}
      <div class="offered" role="group" aria-label="Known labels">
        {#each suggestions as label (label)}
          <button
            type="button"
            class="orden-chip is-quiet"
            onmousedown={(event) => event.preventDefault()}
            onclick={() => {
              newLabel = ''
              addLabel(label)
            }}>{label}</button
          >
        {/each}
      </div>
    {/if}
  </div>

  <div class="group">
    <p class="orden-section">
      Subtasks{#if todo.subtasks.length}<span>{subtasksDone}/{todo.subtasks.length}</span>{/if}
    </p>
    {#if todo.subtasks.length}
      <ul>
        {#each todo.subtasks as subtask (subtask.id)}
          <li class="subtask orden-row is-short" class:done={subtask.done}>
            <input
              type="checkbox"
              class="orden-checkbox"
              aria-label="Done"
              checked={subtask.done}
              onchange={(event) => tickSubtask(subtask.id, event.currentTarget.checked)}
            />
            <span class="words">{subtask.title}</span>
            <button
              type="button"
              class="off"
              aria-label="Remove subtask"
              title="Remove"
              onclick={() => dropSubtask(subtask.id)}
            >
              <Cross small />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <label class="adding orden-field">
      <svg class="orden-field-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
      <input
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
    </label>
  </div>

  {#if refused}
    <p class="refused" role="alert">{refused}</p>
  {/if}

  <div class="foot">
    <button type="button" class="danger orden-action is-danger" onclick={onremove}>Delete todo</button>
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--bg);
    box-shadow: var(--shadow-sm);
    font-family: var(--font-ui);
  }
  .head {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    margin-inline-start: calc(-1px - var(--space-2));
  }
  .title {
    flex: 1;
    font-size: var(--text-base);
  }
  .close {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }
  .close :global(.orden-cross) {
    width: var(--icon-md);
    height: var(--icon-md);
    stroke-width: 1.5;
  }
  .description {
    margin-inline-start: calc(-1px - var(--space-2));
    width: calc(100% + 2px + 2 * var(--space-2));
    min-height: 2.6em;
    overflow: hidden;
    font-size: var(--text-sm);
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-3) var(--space-2);
  }
  .field,
  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .name {
    color: var(--muted-strong);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
  }
  .group > .orden-section {
    margin: 0;
    padding-inline: 0;
  }
  .chips,
  .offered {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    align-items: center;
  }
  .chip {
    display: inline-flex;
    gap: 2px;
    align-items: center;
    padding: 2px 4px 2px var(--space-2);
    border: 1px solid var(--line-strong);
    border-radius: 99px;
    color: var(--text);
    font-size: var(--text-sm);
    animation: arrive var(--dur-base) var(--ease-spring);
  }
  .off {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 99px;
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      color var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }
  .off :global(.orden-cross) {
    width: 8px;
    height: 8px;
    stroke-width: 1.4;
  }
  @media (hover: hover) {
    .off:hover {
      color: var(--danger);
    }
  }
  .new {
    flex: 1 1 6rem;
    width: auto;
    font-size: var(--text-sm);
    font-weight: var(--weight-row);
  }
  ul {
    display: flex;
    flex-direction: column;
    margin: 0 calc(-1 * var(--row-pad));
    padding: 0;
    list-style: none;
  }
  .subtask {
    gap: var(--space-2);
  }
  .subtask .orden-checkbox {
    margin: 0;
  }
  .words {
    flex: 1;
    min-width: 0;
    color: var(--text);
    overflow-wrap: anywhere;
    transition: color var(--dur-fast) var(--ease-out);
  }
  .subtask.done .words {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }
  .subtask .off {
    opacity: 0;
  }
  .subtask:hover .off,
  .subtask .off:focus-visible,
  :global([data-touch]) .subtask .off {
    opacity: 1;
  }
  .refused {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    border-top: 1px solid var(--line);
  }
  .danger {
    width: auto;
  }
  @keyframes arrive {
    from {
      opacity: 0;
      transform: scale(0.9);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .chip {
      animation: none;
    }
  }
</style>
