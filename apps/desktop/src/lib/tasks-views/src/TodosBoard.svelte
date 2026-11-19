<script lang="ts">
  import { placedBetween, SORTS, startTodos, todos, type Todo, type TodoPatch } from '../../tasks-model/src/api'
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../platform/src/api'
  import { Select } from '../../ui-controls/src/api'
  import { addTodo, patchTodo, removeTodo } from './acts'
  import { dropAt } from './drop-at'
  import Filters from './Filters.svelte'
  import { shellWorld, Shown, SORT_NAMES } from './shown.svelte'
  import TodoEditor from './TodoEditor.svelte'
  import { rowKeys, TodoRows } from './rows.svelte'
  import TodoRow from './TodoRow.svelte'

  startTodos()
  const shown = new Shown(shellWorld(() => todos.todos))
  let typed = $state('')
  let openId = $state<string | null>(null)
  const rows = new TodoRows({
    order: () => shown.groups.flatMap((group) => group.todos),
    opened: () => openId,
    open: (id) => (openId = id),
  })
  $effect(() => rows.keep())
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
    <div class="sort" data-todos-sort>
      <span>Sort</span>
      <Select
        plain
        label="Sort"
        value={shown.sort}
        options={SORTS.map((sort) => ({ value: sort, label: SORT_NAMES[sort] }))}
        onchange={(next: string) => shown.setSort(next as (typeof SORTS)[number])}
      />
    </div>
    <form
      class="adder"
      onsubmit={(event) => {
        event.preventDefault()
        void add()
      }}
    >
      <label class="orden-field">
        <svg class="orden-field-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
        <input type="text" placeholder="Add a todo" aria-label="Add a todo" data-todos-add bind:value={typed} />
      </label>
    </form>
  </header>

  <div class="body">
    <div class="columns" use:rowKeys={rows}>
      {#each shown.groups as group (group.label ?? '')}
        <section class="column" aria-label={group.label ?? 'No label'} data-todos-column>
          <h2>
            {group.label ?? 'No label'}
            <span class="count">{group.todos.length}</span>
          </h2>
          <ul>
            {#each group.todos as todo, at (todo.id)}
              <li
                class="card"
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
                  const box = event.currentTarget.getBoundingClientRect()
                  dropped(group.todos, dropAt(at, event.clientY, box))
                }}
              >
                <TodoRow
                  {todo}
                  today={shown.filter.today}
                  open={openId === todo.id}
                  showLabels={todo.labels.length > 1}
                  ontoggle={(done: boolean) => void patchTodo(todo.id, { done })}
                  picked={rows.picking.has(todo.id)}
                  onopen={() => (openId = openId === todo.id ? null : todo.id)}
                  onpick={(event: MouseEvent) => rows.click(event, todo.id)}
                  onmenu={(event: MouseEvent) => rows.menu(event, todo)}
                  onaway={() => void rows.remove([todo.id])}
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
      <aside class="side" in:fly={{ x: 24, duration: dur(200), easing: cubicOut }}>
        <TodoEditor
          todo={open}
          spaces={shown.spaces}
          knownLabels={shown.labels}
          onchange={(patch: TodoPatch) => patchTodo(open.id, patch)}
          onremove={() => {
            void removeTodo(open.id)
            openId = null
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
    font-family: var(--font-ui);
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
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
  .adder {
    flex: 1;
    min-width: 12rem;
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
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }
  h2 {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    margin: 0 0 var(--space-2);
    padding: var(--space-1) var(--space-2) 0;
    color: var(--text-strong);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
  }
  .count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 99px;
    background: var(--surface-3);
    color: var(--muted-strong);
    font-size: var(--text-xs);
    font-weight: var(--weight-row);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .card {
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg);
    box-shadow: var(--shadow-sm);
    transition:
      opacity var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-out);
  }
  .card.dragging {
    opacity: 0.5;
    transform: scale(0.98);
  }
  .tail {
    min-height: var(--space-3);
  }
  .empty {
    margin: 0;
    padding: var(--space-5);
    color: var(--muted);
    font-size: var(--text-sm);
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
