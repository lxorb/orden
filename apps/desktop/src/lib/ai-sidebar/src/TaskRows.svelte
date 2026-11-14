<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../platform/src/api'
  import type { Listed } from './chat-parts'

  const { said }: { said: string } = $props()

  type Task = Listed['tasks'][number]

  function read(text: string): Listed | null {
    try {
      const value: unknown = JSON.parse(text)
      if (typeof value !== 'object' || value === null || !('tasks' in value)) return null
      const { tasks, total, filter } = value as Record<string, unknown>
      if (!Array.isArray(tasks)) return null
      const rows = tasks.filter(
        (one): one is Task =>
          typeof one === 'object' &&
          one !== null &&
          typeof (one as Task).at === 'string' &&
          typeof (one as Task).text === 'string' &&
          typeof (one as Task).space === 'string',
      )
      return {
        tasks: rows,
        total: typeof total === 'number' ? total : rows.length,
        ...(typeof filter === 'string' ? { filter } : {}),
      }
    } catch {
      return null
    }
  }

  const listed = $derived(read(said))

  let ticked = $state<Record<string, boolean>>({})

  const placeOf = (one: Task) => `${one.space}\n${one.at}`
  const isDone = (one: Task) => ticked[placeOf(one)] ?? (one.status === 'x' || one.status === 'X')

  function tick(one: Task) {
    const done = !isDone(one)
    const place = placeOf(one)
    ticked = { ...ticked, [place]: done }
    void import('../../task-actions')
      .then(({ tickTask }) => tickTask(one.at, done))
      .catch(() => false)
      .then((landed) => {
        if (!landed && ticked[place] === done) ticked = { ...ticked, [place]: !done }
      })
  }

  function open() {
    void import('../../todos-entry').then(({ showTodos }) => showTodos())
  }

  const when = (one: Task) => [one.due, one.time].filter(Boolean).join(' ')
</script>

{#if listed}
  <div class="tasks" in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
    {#if listed.filter}
      <code class="filter">{listed.filter}</code>
    {/if}
    {#each listed.tasks as one, at (at)}
      <div class="task" class:done={isDone(one)}>
        <button
          class="box"
          class:p1={one.priority === 1}
          class:p2={one.priority === 2}
          class:p3={one.priority === 3}
          role="checkbox"
          aria-checked={isDone(one)}
          aria-label="Done"
          onclick={() => tick(one)}
        ></button>
        <button class="words" title={one.space} onclick={open}>{one.text}</button>
        {#if when(one)}
          <span class="when">{when(one)}</span>
        {/if}
      </div>
    {:else}
      <span class="none">∅</span>
    {/each}
    {#if listed.total > listed.tasks.length}
      <span class="none">+{listed.total - listed.tasks.length}</span>
    {/if}
  </div>
{/if}

<style>
  .tasks {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .filter {
    align-self: flex-start;
    margin-bottom: var(--space-1);
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--ink-wash);
    color: var(--muted-strong);
    font-family: var(--font-mono);
  }

  .task {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .task.done {
    opacity: 0.5;
  }

  .box {
    flex: none;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 1.5px solid var(--muted);
    border-radius: 4px;
    background: transparent;
    cursor: pointer;
    transition:
      background var(--dur-instant) var(--ease-out),
      border-color var(--dur-instant) var(--ease-out);
  }

  .box.p1 {
    border-color: var(--canvas-1);
  }

  .box.p2 {
    border-color: var(--canvas-2);
  }

  .box.p3 {
    border-color: var(--canvas-5);
  }

  .task.done .box {
    border-color: var(--accent);
    background: var(--accent);
  }

  .box:active {
    transform: scale(0.9);
  }

  .words {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .task.done .words {
    text-decoration: line-through;
  }

  .when,
  .none {
    flex: none;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
