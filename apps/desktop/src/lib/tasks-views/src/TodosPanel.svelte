<script lang="ts">
  import { startTodos, todos, type TodoPatch } from '../../tasks-model/src/api'
  import { addTodo, patchTodo, removeTodo } from './acts'
  import Filters from './Filters.svelte'
  import { shellWorld, Shown } from './shown.svelte'
  import TodoEditor from './TodoEditor.svelte'
  import TodoRow from './TodoRow.svelte'

  startTodos()

  const shown = new Shown(shellWorld(() => todos.todos))
  let typed = $state('')
  let openId = $state<string | null>(null)

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
    <input
      class="field"
      type="text"
      placeholder="Add a todo"
      aria-label="Add a todo"
      data-todos-add
      bind:value={typed}
    />
  </form>
  {#if !shown.todos.length}
    <p class="empty">Nothing to do</p>
  {/if}
  <ul class="list">
    {#each shown.todos as todo (todo.id)}
      {@const here = open?.id === todo.id ? open : null}
      <li>
        <TodoRow
          {todo}
          today={shown.filter.today}
          open={openId === todo.id}
          ontoggle={(done: boolean) => void patchTodo(todo.id, { done })}
          onopen={() => (openId = openId === todo.id ? null : todo.id)}
        />
        {#if here}
          <TodoEditor
            todo={here}
            spaces={shown.spaces}
            knownLabels={shown.labels}
            onchange={(patch: TodoPatch) => patchTodo(here.id, patch)}
            onremove={() => {
              openId = null
              void removeTodo(here.id)
            }}
            onclose={() => (openId = null)}
          />
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

  .field {
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text-strong);
    font: inherit;
    font-size: var(--text-sm);
  }

  .empty {
    margin: 0;
    padding: var(--space-2);
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
