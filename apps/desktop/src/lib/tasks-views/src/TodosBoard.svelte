<script lang="ts">
  import {
    columnPatch,
    GROUPING_NAMES,
    GROUPINGS,
    type Grouping,
    priorityTone,
    SORTS,
    startTodos,
    todos,
    type TodoPatch,
  } from '../../tasks-model/src/api'
  import { cubicOut } from 'svelte/easing'
  import { tick } from 'svelte'
  import { dur, fly, slide } from '../../platform/src/api'
  import { Select } from '../../ui-controls/src/api'
  import { addTodo, doWithAi, patchTodo, removeTodo } from './acts'
  import { Carrying, columnPreview } from './carrying.svelte'
  import Filters from './Filters.svelte'
  import { away, glider } from './glide'
  import { openNote } from './notes'
  import { shellWorld, Shown, SORT_NAMES } from './shown.svelte'
  import TodoEditor from './TodoEditor.svelte'
  import { edgeScroll, previewed } from './todo-drag.svelte'
  import { rowKeys, TodoRows } from './rows.svelte'
  import TodoRow from './TodoRow.svelte'

  startTodos()
  const shown = new Shown(
    shellWorld(() => todos.todos),
    'board',
  )
  let typed = $state('')
  let openId = $state<string | null>(null)
  let adding = $state<string | null>(null)
  let columnTyped = $state('')
  let columnField = $state<HTMLInputElement | null>(null)
  const columns = $derived(shown.columns)
  const carrying: Carrying = new Carrying({
    shown,
    list: (key) => columns.find((one) => one.key === key)?.todos ?? [],
    grouping: () => shown.grouping,
    group: (id) => rows.group(id),
    columnOf: (id) => columns.find((one) => one.todos.some((todo) => todo.id === id))?.key ?? null,
  })
  const rows: TodoRows = new TodoRows({
    shown,
    order: () => columns.flatMap((column) => column.todos),
    opened: () => openId,
    open: (id) => (openId = id),
    move: async (id, by) => {
      const column = columns.find((one) => one.todos.some((todo) => todo.id === id))
      if (column) await carrying.step(column.key, id, by)
    },
  })
  $effect(() => rows.keep())
  const open = $derived(openId === null ? null : todos.todo(openId))
  const shownColumns = $derived(columnPreview(columns, carrying.drag))
  const lists = $derived(shownColumns.map((column) => previewed(column.todos, column.key, carrying.drag)))
  const laid = $derived(
    lists.map((list, at) => [shownColumns[at]?.key, ...list.map((one) => one.id)].join('\n')).join('\n\n'),
  )
  let row = $state<HTMLElement | null>(null)
  const glide = glider(() => row, ['[data-todos-column]', '[data-todos-column] li'])
  $effect.pre(() => {
    if (laid) glide.before()
  })
  $effect(() => {
    if (laid) glide.after()
  })
  async function add() {
    const title = typed.trim()
    if (title === '') return
    typed = ''
    await addTodo(shown, title)
  }
  async function startAdding(key: string) {
    adding = key
    columnTyped = ''
    await tick()
    columnField?.focus()
  }
  async function addInColumn(key: string) {
    const title = columnTyped.trim()
    if (title === '') return
    columnTyped = ''
    const patch = columnPatch(shown.grouping, key, shown.filter.today) ?? {}
    const labels =
      shown.grouping === 'label' ? (patch.labels ?? []) : shown.filter.label === null ? [] : [shown.filter.label]
    await addTodo(shown, title, { ...patch, labels })
  }
</script>

<div class="board" data-todos-board>
  <header class="bar">
    <Filters {shown} />
    <div class="pick" data-todos-group>
      <span>Group</span>
      <Select
        plain
        label="Group"
        value={shown.grouping}
        options={GROUPINGS.map((one) => ({ value: one, label: GROUPING_NAMES[one] }))}
        onchange={(next: string) => shown.setGrouping(next as Grouping)}
      />
    </div>
    <div class="pick" data-todos-sort>
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
    <div
      class="columns"
      bind:this={row}
      use:rowKeys={rows}
      use:edgeScroll={'x'}
      use:carrying.row={(key: string, at: number) => shown.moveColumn(key, at)}
    >
      {#each shownColumns as column, at (column.key)}
        {@const list = lists[at] ?? []}
        <section
          class="column"
          class:is-taking={carrying.drag.spot?.column === column.key && carrying.drag.from !== column.key}
          class:is-lifted={carrying.drag.column === column.key}
          aria-label={column.name}
          data-todos-column
          data-key={column.key}
          use:carrying.area={column.key}
        >
          <h2 use:carrying.head={column.key} title="Drag to move this column">
            <span
              class="name"
              style:color={shown.grouping === 'priority' ? priorityTone(Number(column.key)) : undefined}
              >{column.name}</span
            >
            <span class="count">{column.todos.length}</span>
            {#if column.takes}
              <button
                type="button"
                class="plus orden-glyph"
                aria-label={`Add a todo to ${column.name}`}
                title={`Add a todo to ${column.name}`}
                data-todos-column-add
                onclick={() => void startAdding(column.key)}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
              </button>
            {/if}
          </h2>
          {#if adding === column.key}
            <form
              class="column-adder"
              transition:slide={{ duration: dur(160), easing: cubicOut }}
              onsubmit={(event) => {
                event.preventDefault()
                void addInColumn(column.key)
              }}
            >
              <input
                bind:this={columnField}
                bind:value={columnTyped}
                class="orden-field"
                type="text"
                placeholder="Add a todo"
                aria-label={`Add a todo to ${column.name}`}
                data-todos-column-field
                onkeydown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    adding = null
                  }
                }}
                onblur={() => {
                  if (columnTyped.trim() === '') adding = null
                }}
              />
            </form>
          {/if}
          <ul use:edgeScroll>
            {#each list as todo (todo.id)}
              <li out:away>
                <div class="card" use:carrying.card={{ todo, column: column.key }}>
                  <TodoRow
                    {todo}
                    today={shown.filter.today}
                    open={openId === todo.id}
                    showLabels={shown.grouping !== 'label' || todo.labels.length > 1}
                    lifted={carrying.drag.carries(todo.id)}
                    taking={carrying.taking === todo.id}
                    ontoggle={(done: boolean) => void rows.tick(todo.id, done)}
                    picked={rows.picking.has(todo.id)}
                    onopen={() => (openId = openId === todo.id ? null : todo.id)}
                    onpick={(event: MouseEvent) => rows.click(event, todo.id)}
                    onmenu={(event: MouseEvent) => rows.menu(event, todo)}
                    onaway={() => void rows.remove([todo.id])}
                    onai={() => void doWithAi(todo, shown.space?.id ?? null)}
                    onnote={openNote}
                  />
                </div>
              </li>
            {/each}
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
          knownLabels={shown.labels}
          onchange={(patch: TodoPatch) => patchTodo(open.id, patch)}
          onremove={() => {
            void removeTodo(open.id)
            openId = null
          }}
          onclose={() => (openId = null)}
          onai={() => void doWithAi(open, shown.space?.id ?? null)}
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
  .pick {
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
    display: flex;
    flex: none;
    flex-direction: column;
    width: 17rem;
    max-height: 100%;
    padding: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }
  .column.is-taking {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .column.is-lifted {
    opacity: 0.45;
  }
  h2 {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    min-height: var(--row-height);
    margin: 0 0 var(--space-2);
    padding: 0 var(--space-1) 0 var(--space-2);
    color: var(--text-strong);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: grab;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
  .plus {
    margin-inline-start: auto;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .column:hover .plus,
  .plus:focus-visible,
  :global([data-touch]) .plus {
    opacity: 1;
  }
  .plus svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
  }
  .column-adder {
    margin: 0 0 var(--space-2);
  }
  .column-adder input {
    width: 100%;
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: var(--space-6);
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
  }
  .card {
    --todo-card: var(--bg);
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
