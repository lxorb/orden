<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, slide } from '../../platform/src/api'
  import { startTodos, todos, type TodoPatch } from '../../tasks-model/src/api'
  import { addTodo, patchTodo, removeTodo } from './acts'
  import Filters from './Filters.svelte'
  import { shellWorld, Shown } from './shown.svelte'
  import TodoEditor from './TodoEditor.svelte'
  import { rowKeys, TodoRows } from './rows.svelte'
  import TodoRow from './TodoRow.svelte'

  startTodos()
  const shown = new Shown(shellWorld(() => todos.todos))
  let typed = $state('')
  let openId = $state<string | null>(null)
  const rows = new TodoRows({
    order: () => shown.todos,
    opened: () => openId,
    open: (id) => (openId = id),
  })
  $effect(() => rows.keep())
  const open = $derived(openId === null ? null : todos.todo(openId))
  async function add() {
    const title = typed.trim()
    if (title === '') return
    typed = ''
    await addTodo(shown, title)
  }
</script>

<section class="todos" aria-label="Todos" data-todos-panel>
  <Filters {shown} />
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
  <ul class="list" use:rowKeys={rows}>
    {#each shown.todos as todo (todo.id)}
      {@const here = open?.id === todo.id ? open : null}
      <li>
        <TodoRow
          {todo}
          today={shown.filter.today}
          open={openId === todo.id}
          ontoggle={(done: boolean) => void patchTodo(todo.id, { done })}
          picked={rows.picking.has(todo.id)}
          onopen={() => (openId = openId === todo.id ? null : todo.id)}
          onpick={(event: MouseEvent) => rows.click(event, todo.id)}
          onmenu={(event: MouseEvent) => rows.menu(event, todo)}
          onaway={() => void rows.remove([todo.id])}
        />
        {#if here}
          <div class="sheet" in:slide={{ duration: dur(180), easing: cubicOut }}>
            <TodoEditor
              todo={here}
              spaces={shown.spaces}
              knownLabels={shown.labels}
              onchange={(patch: TodoPatch) => patchTodo(here.id, patch)}
              onremove={() => {
                void removeTodo(here.id)
                openId = null
              }}
              onclose={() => (openId = null)}
            />
          </div>
        {/if}
      </li>
    {/each}
  </ul>
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
  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .sheet {
    padding: var(--space-1) 0 var(--space-2);
  }
</style>
