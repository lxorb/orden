<script lang="ts">
  import { PRIORITY_NAMES, priorityTone, type Todo } from '../../tasks-model/src/api'
  import { dayWords } from '../../ui-controls/src/api'
  import { longPress } from '../../ui-kit/src/api'
  import { linksIn } from './acts'
  import { rowMenu } from './rows.svelte'
  import { swipeAway } from './swipe-away'

  const {
    todo,
    today,
    open,
    showLabels = true,
    picked = false,
    lifted = false,
    taking = false,
    ontoggle,
    onopen,
    onpick = () => false,
    onmenu,
    onaway,
    onai,
    onnote,
  }: {
    todo: Todo
    today: string
    open: boolean
    showLabels?: boolean
    picked?: boolean
    lifted?: boolean
    taking?: boolean
    ontoggle: (done: boolean) => void
    onopen: () => void
    onpick?: (event: MouseEvent) => boolean
    onmenu?: (event: MouseEvent) => void
    onaway?: () => void
    onai?: () => void
    onnote?: (name: string) => unknown
  } = $props()
  const late = $derived(!todo.done && todo.deadline !== null && todo.deadline < today)
  const subtasksDone = $derived(todo.subtasks.filter((one) => one.done).length)
  const notes = $derived(linksIn(todo.description))
  const tone = $derived(priorityTone(todo.priority))
  const repeats = $derived(todo.repeat === null ? null : todo.repeat.replace(/ when done$/, ' after done'))
</script>

<div
  class="todo orden-row"
  class:is-on={open}
  class:is-picked={picked}
  class:is-taking={taking}
  class:is-lifted={lifted}
  class:done={todo.done}
  data-todo={todo.id}
  use:rowMenu={(event: MouseEvent) => onmenu?.(event)}
  use:longPress={(event) => onmenu?.(event)}
  use:swipeAway={() => onaway?.()}
>
  <input
    class="tick orden-checkbox"
    type="checkbox"
    aria-label="Done"
    checked={todo.done}
    style:--tone={tone}
    class:toned={tone !== undefined}
    onchange={(event) => ontoggle(event.currentTarget.checked)}
  />
  <button
    type="button"
    class="body"
    aria-expanded={open}
    onclick={(event) => {
      if (!onpick(event)) onopen()
    }}
  >
    <span class="title">{todo.title}</span>
    {#if picked}<span class="orden-said">Selected</span>{/if}
    {#if todo.priority > 0 || todo.deadline !== null || repeats !== null || todo.subtasks.length || (showLabels && todo.labels.length)}
      <span class="meta">
        {#if todo.priority > 0}
          <span class="priority" style:--tone={tone}>{PRIORITY_NAMES[todo.priority]}</span>
        {/if}
        {#if todo.deadline !== null}
          <span class="deadline" class:late data-deadline={todo.deadline} title={late ? 'Overdue' : undefined}>
            <svg viewBox="0 0 16 16" aria-hidden="true"
              ><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></svg
            >{dayWords(todo.deadline, today, 'short')}</span
          >
        {/if}
        {#if repeats !== null}
          <span class="repeat" data-repeat>
            <svg class="wide" viewBox="0 0 24 24" aria-hidden="true"
              ><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path
                d="M21 13v1a4 4 0 0 1-4 4H3"
              /></svg
            >{repeats}</span
          >
        {/if}
        {#if todo.subtasks.length}
          <span class="subtasks">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3L13 5" /></svg>{subtasksDone}/{todo.subtasks
              .length}</span
          >
        {/if}
        {#if showLabels}
          {#each todo.labels as label (label)}
            <span class="label">{label}</span>
          {/each}
        {/if}
      </span>
    {/if}
  </button>
  {#if notes.length || (onai && !todo.done)}
    <span class="acts">
      {#each notes as name (name)}
        <button type="button" class="act note" title={`Open ${name}`} onclick={() => void onnote?.(name)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3" /></svg><span
            class="name">{name}</span
          >
        </button>
      {/each}
      {#if onai && !todo.done}
        <button type="button" class="act ai" aria-label="Do with AI" title="Do with AI" data-todo-ai onclick={onai}>
          <svg viewBox="0 0 16 16" aria-hidden="true"
            ><path
              d="M8 2.2l1.3 3.4 3.5 1.4-3.5 1.4L8 11.8 6.7 8.4 3.2 7l3.5-1.4zM12.6 10.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z"
            /></svg
          >
        </button>
      {/if}
    </span>
  {/if}
</div>

<style>
  .todo {
    touch-action: pan-y;
    position: relative;
    align-items: flex-start;
    gap: var(--space-2);
    padding-block: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--todo-card, var(--surface));
    transition:
      translate var(--dur-base) var(--ease-out),
      opacity var(--dur-base) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .todo:hover {
      border-color: var(--line-strong);
      box-shadow: var(--shadow-sm);
    }
  }
  .todo.is-on {
    border-color: var(--line-strong);
  }
  .todo.is-picked {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .todo.is-taking {
    border-color: var(--accent);
  }
  .todo.is-lifted {
    opacity: 0.35;
    box-shadow: none;
  }
  :global(.carried > .todo) {
    border-color: var(--line-strong);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    opacity: 0.95;
  }
  .tick {
    flex: none;
    margin: 3px 0 0;
  }
  .is-on .tick:not(:checked) {
    border-color: var(--muted);
  }
  .tick.toned:not(:checked) {
    border-color: var(--tone);
  }
  .body {
    border-radius: var(--radius-sm);
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }
  .title {
    color: var(--text-strong);
    overflow-wrap: anywhere;
    transition: color var(--dur-base) var(--ease-out);
  }
  .done .title {
    color: var(--muted);
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px var(--space-2);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-row);
  }
  .meta > span {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  svg {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  svg.wide {
    stroke-width: 2;
  }
  .priority {
    color: var(--tone, var(--muted));
  }
  .late {
    color: var(--danger);
  }
  .label {
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: 99px;
    color: var(--muted-strong);
  }
  .acts {
    display: flex;
    flex: none;
    align-self: center;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-1);
    max-width: 45%;
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: var(--row-height-sm);
    height: var(--row-height-sm);
    padding: 0 var(--space-1);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }
  .act svg {
    width: 13px;
    height: 13px;
  }
  .act.ai {
    justify-content: center;
    opacity: 0;
  }
  .todo:hover .act.ai,
  .todo:focus-within .act.ai {
    opacity: 1;
  }
  :global([data-touch]) .act.ai {
    display: none;
  }

  .act .name {
    overflow: hidden;
    max-width: 8rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (hover: hover) {
    .act:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }
</style>
