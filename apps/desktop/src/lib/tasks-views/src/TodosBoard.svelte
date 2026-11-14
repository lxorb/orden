<script lang="ts">
  import {
    placedBetween,
    SORTS,
    startTodos,
    todos,
    type Todo,
    type TodoPatch,
  } from '../../tasks-model/src/api'
  import { addTodo, patchTodo, removeTodo } from './acts'
  import Filters from './Filters.svelte'
  import { shellWorld, Shown, SORT_NAMES } from './shown.svelte'
  import TodoEditor from './TodoEditor.svelte'
  import TodoRow from './TodoRow.svelte'

  startTodos()

  const shown = new Shown(shellWorld(() => todos.todos))
  let typed = $state('')
  let openId = $state<string | null>(null)
  let dragged = $state<string | null>(null)

  const open = $derived(openId === null ? null : todos.todo(openId))

  async function add() {
    const title = typed.trim()
    if (title === '') return
    typed = ''
    await addTodo(shown, title)
  }

  function dropped(column: readonly Todo[], at: number) {
    const id = dragged
    dragged = null
    if (id === null || shown.sort !== 'manual') return
    const from = column.findIndex((one) => one.id === id)
    if (from === -1 || from === at || from + 1 === at) return
    const without = column.filter((one) => one.id !== id)
    const place = from < at ? at - 1 : at
    void patchTodo(id, { order: placedBetween(without[place - 1], without[place]) })
  }
</script>

<div class="board" data-todos-board>
  <header class="bar">
    <Filters {shown} />
    <label class="sort">
      <span>Sort</span>
      <select
        data-todos-sort
        value={shown.sort}
        onchange={(event) => shown.setSort(event.currentTarget.value as (typeof SORTS)[number])}
      >
        {#each SORTS as sort (sort)}
          <option value={sort}>{SORT_NAMES[sort]}</option>
        {/each}
      </select>
    </label>
    <form
      class="adder"
      onsubmit={(event) => {
        event.preventDefault()
        void add()
      }}
    >
      <input
        class="field"
        type="text"
        placeholder="Add a todo"
        aria-label="Add a todo"
        data-todos-add
        bind:value={typed}
      />
    </form>
  </header>

  <div class="body">
    <div class="columns">
      {#each shown.groups as group (group.label ?? '')}
        <section class="column" aria-label={group.label ?? 'No label'} data-todos-column>
          <h2>
            {group.label ?? 'No label'}
            <span class="count">{group.todos.length}</span>
          </h2>
          <ul>
            {#each group.todos as todo, at (todo.id)}
              <li
                draggable={shown.sort === 'manual'}
                class:dragging={dragged === todo.id}
                ondragstart={(event) => {
                  dragged = todo.id
                  event.dataTransfer?.setData('text/plain', todo.id)
                }}
                ondragend={() => (dragged = null)}
                ondragenter={(event) => {
                  if (shown.sort === 'manual' && dragged !== null) event.preventDefault()
                }}
                ondragover={(event) => {
                  if (shown.sort === 'manual' && dragged !== null) event.preventDefault()
                }}
                ondrop={(event) => {
                  event.preventDefault()
                  dropped(group.todos, at)
                }}
              >
                <TodoRow
                  {todo}
                  today={shown.filter.today}
                  open={openId === todo.id}
                  showLabels={todo.labels.length > 1}
                  ontoggle={(done: boolean) => void patchTodo(todo.id, { done })}
                  onopen={() => (openId = openId === todo.id ? null : todo.id)}
                />
              </li>
            {/each}
            <li
              class="tail"
              ondragenter={(event) => {
                if (shown.sort === 'manual' && dragged !== null) event.preventDefault()
              }}
              ondragover={(event) => {
                if (shown.sort === 'manual' && dragged !== null) event.preventDefault()
              }}
              ondrop={(event) => {
                event.preventDefault()
                dropped(group.todos, group.todos.length)
              }}
            ></li>
          </ul>
        </section>
      {:else}
        <p class="empty">Nothing to do</p>
      {/each}
    </div>
    {#if open}
      <aside class="side">
        <TodoEditor
          todo={open}
          spaces={shown.spaces}
          knownLabels={shown.labels}
          onchange={(patch: TodoPatch) => patchTodo(open.id, patch)}
          onremove={() => {
            openId = null
            void removeTodo(open.id)
          }}
          onclose={() => (openId = null)}
        />
      </aside>
    {/if}
  </div>
</div>

<style>
  .board {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--line);
  }

  .sort {
    display: inline-flex;
    gap: var(--space-1);
    align-items: center;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .field {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .adder {
    flex: 1;
    min-width: 12rem;
  }

  .field {
    width: 100%;
    color: var(--text-strong);
  }

  .body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .columns {
    display: flex;
    flex: 1;
    gap: var(--space-3);
    align-items: flex-start;
    min-width: 0;
    overflow: auto;
    padding: var(--space-3);
  }

  .column {
    flex: none;
    width: 17rem;
    max-height: 100%;
    overflow: auto;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  h2 {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
    margin: 0 0 var(--space-2);
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
  }

  .count {
    color: var(--muted);
    font-weight: normal;
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
    border-radius: var(--radius-row);
    background: var(--surface);
  }

  li.dragging {
    opacity: 0.5;
  }

  .tail {
    min-height: var(--space-3);
    background: none;
  }

  .empty {
    margin: 0;
    color: var(--muted);
  }

  .side {
    flex: none;
    width: 22rem;
    overflow: auto;
    padding: var(--space-3);
    border-inline-start: 1px solid var(--line);
  }

  @media (max-width: 48rem) {
    .body {
      flex-direction: column;
    }

    .side {
      width: auto;
      border-inline-start: none;
      border-top: 1px solid var(--line);
    }
  }
</style>
