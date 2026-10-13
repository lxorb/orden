<script lang="ts">
  /** A task in a list, Todoist's row in nib's shapes: the box, the words with their
   *  inline marks, the first line of the description under them, and a meta line - the
   *  day in the colour of how near it is, ↻, the deadline, the duration, the bell, how
   *  many sub-tasks are done, how many comments, the labels - with where it lives at its
   *  end. Under the pointer it offers to schedule it and its menu (task-actions.ts).
   *
   *  As tall as its lines, exactly (`lines`, worked out by the list from task-meta.ts),
   *  so the list places every row by arithmetic and measures none. */
  import type { Row } from '@nib/bases'
  import { linkModifier } from '@nib/editor'
  import Bell from 'lucide/dist/esm/icons/bell.mjs'
  import Calendar from 'lucide/dist/esm/icons/calendar-days.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import ListTree from 'lucide/dist/esm/icons/list-tree.mjs'
  import Message from 'lucide/dist/esm/icons/message-square.mjs'
  import Pencil from 'lucide/dist/esm/icons/pencil.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import Target from 'lucide/dist/esm/icons/target.mjs'
  import Timer from 'lucide/dist/esm/icons/timer.mjs'
  import { amount, t } from '../i18n.svelte'
  import Glyph from '../quick-add/Glyph.svelte'
  import { durationLabel } from '../quick-add/labels'
  import Twist from '../Twist.svelte'
  import { workspace } from '../workspace.svelte'
  import { blockerOf } from './chips'
  import { draggable } from './drag.svelte'
  import { plain } from './inline'
  import type { Kit } from './kit'
  import { metaOf, type Subtasks } from './task-meta'
  import { scheduleRows, taskMenu } from './task-actions'
  import TaskBox from './TaskBox.svelte'
  import TaskEditor from './TaskEditor.svelte'
  import Words from './Words.svelte'

  const {
    row,
    kit,
    lines,
    dated = true,
    where = true,
    depth = 0,
    twist = null,
    ontwist,
    selected = false,
    onselect,
    subtasks,
    editing = false,
    onedit,
    onsize,
  }: {
    row: Row
    kit: Kit
    /** How many lines it is drawn on: 1 to 3. */
    lines: number
    dated?: boolean
    where?: boolean
    depth?: number
    twist?: 'open' | 'shut' | null
    ontwist?: () => void
    selected?: boolean
    onselect?: () => void
    subtasks?: Subtasks | undefined
    /** Whether the task is being changed in its own field over the row. */
    editing?: boolean
    onedit?: (on: boolean) => void
    /** How tall the field standing in the row is, as it changes. */
    onsize?: (tall: number) => void
  } = $props()

  const task = $derived(row.task)
  const label = $derived(task ? plain(task.text) : row.file.basename)
  const meta = $derived(task ? metaOf(task, kit.live.today, dated, subtasks) : [])
  const section = $derived(task?.section.at(-1))
  const blocker = $derived(task?.dependsOn.length ? blockerOf(task, kit.live.rows) : null)
  const tone = $derived(kit.live.colourOf(row))
  /** Which space, where it is not the open one (decision 8.4). */
  const elsewhere = $derived(
    kit.spec.builtin !== undefined && row.space !== workspace.activeSpace?.name ? row.space : null,
  )

  const TONES = {
    late: 'var(--danger)',
    today: 'var(--success)',
    tomorrow: 'var(--canvas-2)',
    week: 'var(--canvas-6)',
    later: undefined,
  } as const

  /** The note at the line, beside the view (with Ctrl or Cmd, in a tab). */
  function open(event: MouseEvent) {
    onselect?.()
    kit.open(row, linkModifier(event) ? 'tab' : 'aside')
  }

  /** The task's own view; with Ctrl or Cmd, its note in a tab. */
  function view(event: MouseEvent) {
    onselect?.()
    if (linkModifier(event)) kit.open(row, 'tab')
    else kit.openTask(row)
  }

  function schedule(event: MouseEvent) {
    event.stopPropagation()
    onselect?.()
    if (event.currentTarget instanceof Element) scheduleRows([row], event.currentTarget, kit)
  }

  function more(event: MouseEvent) {
    event.stopPropagation()
    event.preventDefault()
    onselect?.()
    taskMenu(event, row, kit)
  }
</script>

{#if task}
  <div
    class="task"
    class:is-on={selected}
    class:finished={task.done || task.cancelled}
    class:toned={tone !== null}
    class:blocked={blocker !== null}
    title={blocker === null ? undefined : t('Blocked by {task}', { task: blocker })}
    style:--row-tone={tone}
    style:--depth={depth}
    style:--lines={lines}
    role="option"
    aria-selected={selected}
    tabindex={selected ? 0 : -1}
    data-row={row.anchor ? `${row.path}#${row.anchor.line}` : row.path}
    use:draggable={{ row, label }}
    onfocus={() => onselect?.()}
    oncontextmenu={more}
  >
    <div class="head">
      {#if twist}
        <button
          type="button"
          class="twist"
          tabindex="-1"
          aria-label={twist === 'open' ? t('Collapse') : t('Expand')}
          aria-expanded={twist === 'open'}
          onclick={(event) => {
            event.stopPropagation()
            ontwist?.()
          }}><Twist open={twist === 'open'} /></button
        >
      {:else if depth}
        <span class="twist" aria-hidden="true"></span>
      {/if}
      <TaskBox {task} {label} ontick={() => kit.tick(row)} />
      <button type="button" class="words" onclick={view} tabindex="-1">
        <Words words={task.text} />
      </button>
      <span class="actions">
        {#if onedit}
          <button
            type="button"
            class="act"
            tabindex="-1"
            aria-label={t('Edit')}
            title={t('Edit')}
            onclick={(event) => {
              event.stopPropagation()
              onselect?.()
              onedit(true)
            }}><Glyph icon={Pencil} /></button
          >
        {/if}
        <button
          type="button"
          class="act"
          tabindex="-1"
          aria-label={t('Schedule')}
          title={t('Schedule')}
          onclick={schedule}><Glyph icon={Calendar} /></button
        >
        <button
          type="button"
          class="act"
          tabindex="-1"
          aria-label={t('More')}
          title={t('More')}
          onclick={more}><Glyph icon={Ellipsis} /></button
        >
      </span>
    </div>

    {#if task.description}
      <button type="button" class="line description" onclick={view} tabindex="-1"
        >{plain(task.description)}</button
      >
    {/if}

    {#if lines > (task.description ? 2 : 1)}
      <div class="line meta">
        {#each meta as one, index (index)}
          {#if one.kind === 'date'}
            <span class="bit" style:color={TONES[one.tone]}
              ><Glyph icon={one.repeat ? Repeat : Calendar} />{one.text}</span
            >
          {:else if one.kind === 'deadline'}
            <span class="bit" class:late={one.late}><Glyph icon={Target} />{one.text}</span>
          {:else if one.kind === 'duration'}
            <span class="bit"><Glyph icon={Timer} />{durationLabel(one.minutes)}</span>
          {:else if one.kind === 'remind'}
            <span class="bit" aria-label={t('Reminder')}><Glyph icon={Bell} /></span>
          {:else if one.kind === 'subtasks'}
            <span class="bit"><Glyph icon={ListTree} />{amount(one.done)}/{amount(one.total)}</span>
          {:else if one.kind === 'comments'}
            <span class="bit"><Glyph icon={Message} />{amount(one.count)}</span>
          {:else if one.kind === 'tag'}
            <span class="bit tag">#{one.tag}</span>
          {:else}
            <span class="bit">+{one.name}</span>
          {/if}
        {/each}
        {#if where}
          <button type="button" class="where" onclick={open} tabindex="-1" title={t('Open')}>
            {#if elsewhere}<span class="space">{elsewhere}</span>{/if}
            {row.file.basename}{#if section}<span class="sep" aria-hidden="true">›</span
              >{section}{/if}
          </button>
        {/if}
      </div>
    {/if}
    {#if editing}
      <TaskEditor {kit} {row} {onsize} onclose={() => onedit?.(false)} />
    {/if}
  </div>
{/if}

<style>
  .task {
    /* The box's width, which the lines under the words start past. */
    --box: 20px;
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: calc(
      var(--task-head, var(--row-height)) + (var(--lines) - 1) * var(--task-line, 18px) +
        min(var(--lines) - 1, 1) * var(--task-foot, 6px)
    );
    padding-inline: calc(var(--row-pad) + var(--depth) * var(--row-indent)) var(--row-pad);
    border-radius: var(--radius-row);
    color: var(--text);
    font-family: var(--font-ui);
    outline-offset: -2px;
    transition:
      background var(--dur-fast) var(--ease-out),
      opacity var(--dur-base) var(--ease-out);
  }

  /* A hairline between tasks, as a list of things to do reads: from the words' edge,
     so the boxes stand on the margin uninterrupted. */
  .task::after {
    content: '';
    position: absolute;
    inset-inline: calc(var(--row-pad) + var(--depth) * var(--row-indent) + 28px) var(--row-pad);
    bottom: 0;
    height: 1px;
    background: var(--line);
    opacity: 0.7;
  }

  @media (hover: hover) {
    .task:hover {
      background: var(--surface-hover);
    }
  }

  .task.is-on {
    background: var(--surface-selected);
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--task-head, var(--row-height));
    min-width: 0;
  }

  .twist {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
    padding: 2px;
    border: none;
    background: none;
    color: var(--muted);
  }

  .words {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
    font-size: var(--text-row);
    text-align: start;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  .actions {
    flex: none;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .task:hover .actions,
  .task.is-on .actions,
  .task:focus-within .actions {
    opacity: 1;
  }

  :global([data-touch]) .actions {
    display: none;
  }

  :global([data-touch]) .task {
    --box: var(--touch-mark);
  }

  .act {
    display: grid;
    place-items: center;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    padding: 0;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .act:hover {
      background: var(--surface-press);
      color: var(--text);
    }
  }

  .act:active {
    transform: scale(0.94);
  }

  /* Every line under the words starts where the words do: past the box and its gap. */
  .line {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: var(--task-line, 18px);
    min-width: 0;
    margin-inline-start: calc(var(--box) + var(--space-2) + var(--twisted, 0px));
    overflow: hidden;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
    white-space: nowrap;
  }

  .task:has(.twist) .line {
    --twisted: calc(var(--icon-md) + var(--space-2));
  }

  .description {
    display: block;
    text-overflow: ellipsis;
    cursor: default;
  }

  .meta {
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .bit {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .bit.late {
    color: var(--danger);
  }

  .where {
    flex: 0 1 auto;
    min-width: 0;
    margin-inline-start: auto;
    overflow: hidden;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }

  @media (hover: hover) {
    .where:hover {
      color: var(--text-strong);
    }
  }

  .sep {
    margin: 0 0.3em;
  }

  .space {
    margin-inline-end: 0.4em;
    color: var(--muted-strong);
  }

  .finished,
  .blocked {
    opacity: 0.55;
  }

  .finished .words {
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }

  .task:global(.is-carried) {
    opacity: 0.35;
  }

  .toned {
    background: color-mix(in srgb, var(--row-tone) 14%, var(--bg));
  }
</style>
