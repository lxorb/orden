<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, slide } from '../../platform/src/api'
  import {
    GROUPING_NAMES,
    GROUPINGS,
    type Grouping,
    startTodos,
    todos,
    type TodoPatch,
  } from '../../tasks-model/src/api'
  import { addTodo, doWithAi, patchTodo, removeTodo } from './acts'
  import { Carrying } from './carrying.svelte'
  import { away, glider } from './glide'
  import Filters from './Filters.svelte'
  import Pick from './Pick.svelte'
  import { openNote } from './notes'
  import { shellWorld, Shown } from './shown.svelte'
  import TodoEditor from './TodoEditor.svelte'
  import { previewed, edgeScroll } from './todo-drag.svelte'
  import { rowKeys, TodoRows } from './rows.svelte'
  import TodoRow from './TodoRow.svelte'

  startTodos()
  const shown = new Shown(shellWorld(() => todos.todos))
  let typed = $state('')
  let openId = $state<string | null>(null)
  const LIST = 'panel:'
  const NONE = 'none'
  const groups = $derived(
    shown.group === null ? [{ key: LIST, name: '', todos: shown.todos, takes: true }] : shown.groups,
  )
  const order = () => groups.flatMap((one) => one.todos).filter((one, at, all) => all.indexOf(one) === at)
  const groupOf = (id: string) => groups.find((one) => one.todos.some((todo) => todo.id === id))?.key ?? null
  const carrying: Carrying = new Carrying({
    shown,
    list: (key) => groups.find((one) => one.key === key)?.todos ?? [],
    grouping: () => shown.group,
    group: (id) => rows.group(id),
    columnOf: groupOf,
  })
  const rows: TodoRows = new TodoRows({
    shown,
    order,
    opened: () => openId,
    open: (id) => (openId = id),
    move: (id, by) => carrying.step(groupOf(id) ?? LIST, id, by),
  })
  $effect(() => rows.keep())
  const open = $derived(openId === null ? null : todos.todo(openId))
  const lists = $derived(groups.map((one) => previewed(one.todos, one.key, carrying.drag)))
  const laid = $derived(
    lists
      .map((list, at) => {
        const key = groups[at]?.key ?? ''
        return [key, shown.folded.includes(key) ? '' : list.map((one) => one.id).join('\n')].join('\n')
      })
      .join('\n\n'),
  )
  let box = $state<HTMLElement | null>(null)
  const glide = glider(() => box, ['[data-todos-list] > li'])
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
</script>

<section class="todos" aria-label="Todos" data-todos-panel use:edgeScroll>
  <div class="bar">
    <Filters {shown} />
    <Pick
      name="Group"
      data-todos-group
      value={shown.group ?? NONE}
      options={[
        { value: NONE, label: 'None' },
        ...GROUPINGS.map((one) => ({ value: one, label: GROUPING_NAMES[one] })),
      ]}
      onchange={(next: string) => shown.setGroup(next === NONE ? null : (next as Grouping))}
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
  {#if !shown.todos.length}
    <p class="empty">Nothing to do</p>
  {/if}
  <div class="lists" bind:this={box} use:rowKeys={rows}>
    {#each groups as group, at (group.key)}
      {@const listed = lists[at] ?? []}
      {@const folded = shown.group !== null && shown.folded.includes(group.key)}
      <section
        class="group"
        class:is-taking={carrying.drag.spot?.column === group.key && carrying.drag.from !== group.key}
        aria-label={shown.group === null ? undefined : group.name}
        data-todos-group-box
        data-key={group.key}
        use:carrying.area={group.key}
      >
        {#if shown.group !== null}
          <button
            type="button"
            class="head"
            aria-expanded={!folded}
            data-todos-group-head
            onclick={() => shown.fold(group.key)}
          >
            <svg class="caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l3 3-3 3" /></svg>
            <span class="name">{group.name}</span>
            <span class="count">{group.todos.length}</span>
          </button>
        {/if}
        {#if !folded}
          <ul class="list" data-todos-list transition:slide={{ duration: dur(180), easing: cubicOut }}>
            {#each listed as todo (todo.id)}
              {@const here = open?.id === todo.id ? open : null}
              <li out:away>
                <div use:carrying.card={{ todo, column: group.key }}>
                  <TodoRow
                    {todo}
                    today={shown.filter.today}
                    open={openId === todo.id}
                    showLabels={shown.group !== 'label' || todo.labels.length > 1}
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
                {#if here}
                  <div class="sheet" in:slide={{ duration: dur(180), easing: cubicOut }}>
                    <TodoEditor
                      todo={here}
                      knownLabels={shown.labels}
                      onchange={(patch: TodoPatch) => patchTodo(here.id, patch)}
                      onremove={() => {
                        void removeTodo(here.id)
                        openId = null
                      }}
                      onclose={() => (openId = null)}
                      onai={() => void doWithAi(here, shown.space?.id ?? null)}
                    />
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/each}
  </div>
</section>

<style>
  .todos {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
  }
  .empty {
    margin: 0;
    padding: var(--space-5) var(--space-2);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
    align-items: center;
  }
  .lists {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .group {
    border-radius: var(--radius-md);
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }
  .group.is-taking {
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .head {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    width: 100%;
    min-height: var(--row-height);
    padding: 0 var(--space-1);
    border: none;
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    text-align: start;
    cursor: pointer;
  }
  .caret {
    flex: none;
    width: 10px;
    height: 10px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transform: rotate(90deg);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  [aria-expanded='false'] .caret {
    transform: none;
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
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-height: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sheet {
    padding: var(--space-1) 0 var(--space-2);
  }
</style>
