<script lang="ts">
  import { PRIORITY_NAMES, priorityTone, type Todo } from '../../tasks-model/src/api'
  import { dayWords } from '../../ui-controls/src/api'
  import { longPress } from '../../ui-kit/src/api'
  import { linksIn } from './acts'
  import { rowMenu } from './rows.svelte'
  import { swipeRow } from './swipe'

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

<div class="swipe" use:swipeRow={{ done: () => ontoggle(!todo.done), remove: onaway }}>
  <div class="under" aria-hidden="true">
    <span class="mark finish">
      <svg viewBox="0 0 24 24"
        ><circle class="ring" cx="12" cy="12" r="9" /><path
          class="stroke"
          pathLength="1"
          d="M7.5 12.4l3 3 6-6.6"
        /></svg
      ><span class="say">{todo.done ? 'Not done' : 'Done'}</span>
    </span>
    <span class="mark bin">
      <span class="say">Delete</span><svg viewBox="0 0 24 24"
        ><g class="lid"><path d="M4 6.5h16" /><path d="M9.5 6.5V4.2h5v2.3" /></g><path
          d="M6.2 6.5l1 13.3h9.6l1-13.3"
        /><path d="M10 10.5v5.5M14 10.5v5.5" /></svg
      >
    </span>
  </div>
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
  >
    <span class="box">
      <input
        class="tick orden-checkbox"
        type="checkbox"
        aria-label="Done"
        checked={todo.done}
        style:--tone={tone}
        class:toned={tone !== undefined}
        onchange={(event) => ontoggle(event.currentTarget.checked)}
      />
      <svg class="draw" viewBox="0 0 16 16" aria-hidden="true"><path pathLength="1" d="M3.8 8.3l2.7 2.7 5.6-6" /></svg>
    </span>
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
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3L13 5" /></svg>{subtasksDone}/{todo
                .subtasks.length}</span
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
</div>

<style>
  .swipe {
    --swipe-x: 0px;
    --swipe-p: 0;
    position: relative;
    touch-action: pan-y;
    border-radius: var(--radius-md);
  }
  .todo {
    touch-action: pan-y;
    position: relative;
    translate: var(--swipe-x) 0;
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
  .swipe:global([data-swipe]) .todo {
    box-shadow: var(--shadow-md);
  }
  .swipe:global([data-dragging]) .todo {
    transition: none;
  }
  .swipe:global([data-settling]) .todo {
    transition:
      translate var(--dur-slow) var(--ease-spring),
      box-shadow var(--dur-slow) var(--ease-out);
  }
  .swipe:global([data-leaving]) .todo {
    transition: translate var(--dur-base) cubic-bezier(0.55, 0, 1, 0.45);
  }
  .under {
    position: absolute;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: space-between;
    padding-inline: var(--space-4);
    overflow: hidden;
    border-radius: inherit;
    color: var(--bg);
    opacity: calc(0.55 + var(--swipe-p) * 0.3);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .swipe:global([data-swipe]) .under {
    display: flex;
  }
  .swipe:global([data-swipe='done']) .under {
    background: var(--success);
  }
  .swipe:global([data-swipe='delete']) .under {
    background: var(--danger);
  }
  .swipe:global([data-armed]) .under,
  .swipe:global([data-ticked]) .under,
  .swipe:global([data-leaving]) .under {
    opacity: 1;
  }
  .swipe:global([data-swipe='done']) .bin,
  .swipe:global([data-swipe='delete']) .finish {
    visibility: hidden;
  }
  .mark {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    scale: calc(0.7 + var(--swipe-p) * 0.3);
    opacity: calc(0.35 + var(--swipe-p) * 0.65);
    transition: scale var(--dur-base) var(--ease-spring);
  }
  .finish {
    transform-origin: left center;
  }
  .bin {
    transform-origin: right center;
  }
  .swipe:global([data-armed]) .mark,
  .swipe:global([data-ticked]) .mark {
    scale: 1.12;
  }
  .mark svg {
    width: 22px;
    height: 22px;
    stroke-width: 1.9;
  }
  .say {
    opacity: 0;
    translate: 0 2px;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      translate var(--dur-fast) var(--ease-out);
  }
  .swipe:global([data-armed]) .say,
  .swipe:global([data-ticked]) .say,
  .swipe:global([data-leaving]) .say {
    opacity: 1;
    translate: 0 0;
  }
  .ring {
    opacity: calc(0.3 + var(--swipe-p) * 0.7);
  }
  .stroke {
    stroke-dasharray: 1;
    stroke-dashoffset: calc(1 - var(--swipe-p));
  }
  .lid {
    transform-box: fill-box;
    transform-origin: 100% 100%;
    rotate: calc(var(--swipe-p) * -34deg);
    translate: 0 calc(var(--swipe-p) * -1.5px);
  }
  .swipe:global([data-armed]) .bin svg {
    animation: rattle var(--dur-slow) var(--ease-out);
  }
  .draw {
    position: absolute;
    inset: 0;
    width: 15px;
    height: 15px;
    pointer-events: none;
    opacity: 0;
    stroke: var(--success);
    stroke-width: 2.2;
  }
  .draw path {
    stroke-dasharray: 1;
    stroke-dashoffset: calc(1 - var(--swipe-p));
  }
  .swipe:global([data-swipe='done']) .todo:not(.done) .draw {
    opacity: 1;
  }
  .swipe:global([data-armed][data-swipe='done']) .todo:not(.done) .tick {
    border-color: var(--success);
  }
  .swipe:global([data-ticked]) .todo:not(.done) .tick {
    border-color: var(--success);
    background: color-mix(in srgb, var(--success) 14%, transparent);
  }
  .swipe:global([data-ticked]) .box {
    animation: pop var(--dur-slow) var(--ease-spring);
  }
  @keyframes pop {
    0% {
      scale: 1;
    }
    45% {
      scale: 1.4;
    }
    100% {
      scale: 1;
    }
  }
  @keyframes rattle {
    0%,
    100% {
      rotate: 0deg;
    }
    30% {
      rotate: -9deg;
    }
    65% {
      rotate: 6deg;
    }
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
  :global(.carried) .todo {
    border-color: var(--line-strong);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    opacity: 0.95;
  }
  .box {
    position: relative;
    flex: none;
    display: flex;
    margin: 3px 0 0;
  }
  .tick {
    margin: 0;
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
