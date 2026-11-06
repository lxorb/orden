<script lang="ts">
  import type { Row, Value } from '@orden/bases'
  import { linkModifier } from '@orden/editor'
  import Calendar from 'lucide/dist/esm/icons/calendar-days.mjs'
  import Check from 'lucide/dist/esm/icons/check.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import Grip from 'lucide/dist/esm/icons/grip-vertical.mjs'
  import Message from 'lucide/dist/esm/icons/message-square.mjs'
  import Pencil from 'lucide/dist/esm/icons/pencil.mjs'
  import Sparkles from 'lucide/dist/esm/icons/sparkles.mjs'
  import { t } from '../i18n.svelte'
  import Glyph from '../quick-add/Glyph.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import Twist from '../Twist.svelte'
  import { viewport } from '../viewport.svelte'
  import { workspace } from '../workspace.svelte'
  import { blockerOf } from './chips'
  import { draggable } from './drag.svelte'
  import { plain } from './inline'
  import type { Kit } from './kit'
  import { metaOf, type Subtasks } from './task-meta'
  import { swipeRow } from './swipe-row'
  import { scheduleRows, taskMenu } from './task-actions'
  import TaskBox from './TaskBox.svelte'
  import TaskEditor from './TaskEditor.svelte'
  import TaskMeta from './TaskMeta.svelte'
  import Words from './Words.svelte'

  const {
    row,
    kit,
    lines,
    card = false,
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
    picked = false,
    picking = false,
    onpick,
    from,
  }: {
    row: Row
    kit: Kit
    lines: number
    card?: boolean
    dated?: boolean
    where?: boolean
    depth?: number
    twist?: 'open' | 'shut' | null
    ontwist?: () => void
    selected?: boolean
    onselect?: () => void
    subtasks?: Subtasks | undefined
    editing?: boolean
    onedit?: (on: boolean) => void
    onsize?: (tall: number) => void
    picked?: boolean
    picking?: boolean
    onpick?: (range: boolean) => void
    from?: Value
  } = $props()

  const task = $derived(row.task)
  const label = $derived(task ? plain(task.text) : row.file.basename)
  const meta = $derived(task ? metaOf(task, kit.live.today, dated, subtasks) : [])
  const blocker = $derived(task?.dependsOn.length ? blockerOf(task, kit.live.rows) : null)
  const tone = $derived(kit.live.colourOf(row))
  const elsewhere = $derived(
    kit.spec.builtin !== undefined && row.space !== workspace.activeSpace?.name ? row.space : null,
  )

  function open(event: MouseEvent) {
    onselect?.()
    kit.open(row, linkModifier(event) ? 'tab' : 'aside')
  }

  function view(event: MouseEvent) {
    onselect?.()
    if (onpick && (event.shiftKey || linkModifier(event) || picking)) onpick(event.shiftKey)
    else kit.openTask(row)
  }

  function press(event: MouseEvent) {
    if (!onpick || !(event.target instanceof Element)) return
    if (event.target.closest('button, a, input, textarea, [contenteditable="true"]')) return
    if (!(event.shiftKey || linkModifier(event) || picking)) return
    onselect?.()
    onpick(event.shiftKey)
  }

  function holdOnRow(event: MouseEvent) {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    if (!event.target.closest('button')) return
    event.preventDefault()
    if (event.currentTarget instanceof HTMLElement)
      event.currentTarget.focus({ preventScroll: true })
  }

  function aux(event: MouseEvent) {
    if (event.button !== 1) return
    event.preventDefault()
    kit.open(row, 'tab')
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
    taskMenu(event, [row], kit, onpick && !picked ? () => onpick(false) : undefined)
  }
</script>

{#if task}
  <div class="swipe" class:card>
    <span class="under" aria-hidden="true"
      ><span class="mark done"><Glyph icon={Check} /></span><span class="mark later"
        ><Glyph icon={Calendar} /></span
      ></span
    >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="task"
      class:is-on={selected}
      class:is-picked={picked}
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
      use:draggable={{ row, label, from }}
      use:swipeRow={{
        on: viewport.touch && !editing,
        right: () => void kit.tick(row),
        left: (box) => scheduleRows([row], box, kit),
      }}
      onfocus={() => onselect?.()}
      onclick={press}
      onmousedown={holdOnRow}
      oncontextmenu={more}
      onauxclick={aux}
    >
      <span class="grip" aria-hidden="true"><Glyph icon={Grip} /></span>
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
        <TaskBox {task} {label} ontick={() => kit.tick(row)} disabled={!kit.writes(row)} />
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
              title={shortcuts.tooltip(t('Edit'), 'tasks.edit')}
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
            title={shortcuts.tooltip(t('Schedule'), 'tasks.schedule')}
            onclick={schedule}><Glyph icon={Calendar} /></button
          >
          <button
            type="button"
            class="act"
            tabindex="-1"
            aria-label={t('Comment')}
            title={shortcuts.tooltip(t('Comment'), 'tasks.comment')}
            onclick={(event) => {
              event.stopPropagation()
              onselect?.()
              kit.openTask(row, true)
            }}><Glyph icon={Message} /></button
          >
          {#if !__EVEN_PLUGIN__ && !task.done && !task.cancelled}
            <button
              type="button"
              class="act"
              tabindex="-1"
              aria-label={t('Do with AI')}
              title={t('Do with AI')}
              onclick={(event) => {
                event.stopPropagation()
                onselect?.()
                const button = event.currentTarget
                void import('../ai/do-task').then(async (one) => {
                  // Where the chat went, once it is there: it starts out of sight.
                  if (await one.doWithAi(row, task.text)) one.sentOff(button)
                })
              }}><Glyph icon={Sparkles} /></button
            >
          {/if}
          <button
            type="button"
            class="act"
            tabindex="-1"
            aria-label={t('More')}
            title={shortcuts.tooltip(t('More'), 'tasks.more')}
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
          <TaskMeta {row} {meta} {where} {elsewhere} onwhere={open} />
        </div>
      {/if}
      {#if editing}
        <TaskEditor {kit} {row} {onsize} onclose={() => onedit?.(false)} />
      {/if}
    </div>
  </div>
{/if}

<style>
  .swipe {
    position: relative;
    overflow-x: clip;
  }

  .under {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-inline: var(--space-4);
    border-radius: var(--radius-row);
    color: var(--accent-ink);
    opacity: 0;
    transition:
      opacity var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .swipe:global([data-swipe]) .under {
    opacity: 1;
    background: var(--surface-press);
  }

  .swipe:global([data-swipe='right'].is-ready) .under {
    background: var(--success);
  }

  .swipe:global([data-swipe='left'].is-ready) .under {
    background: var(--accent);
  }

  .swipe:not([data-swipe='right']) .done,
  .swipe:not([data-swipe='left']) .later {
    visibility: hidden;
  }

  .mark {
    display: grid;
    place-items: center;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  .swipe:global(.is-ready) .mark {
    transform: scale(1.15);
  }

  .task {
    --box: 20px;
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    height: calc(
      2 * var(--card-pad, 0px) + var(--task-head, var(--row-height)) + (var(--lines) - 1) *
        var(--task-line, 18px) + min(var(--lines) - 1, 1) * var(--task-foot, 6px)
    );
    padding-block: var(--card-pad, 0px);
    padding-inline: calc(var(--row-pad) + var(--depth) * var(--row-indent)) var(--row-pad);
    border-radius: var(--radius-row);
    color: var(--text);
    font-family: var(--font-ui);
    outline-offset: -2px;
    transition:
      background var(--dur-fast) var(--ease-out),
      opacity var(--dur-base) var(--ease-out),
      translate var(--dur-base) var(--ease-out);
  }

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

  .card {
    --card-pad: var(--task-pad, 6px);
    padding-block-end: var(--task-gap, 6px);
  }

  .card .under {
    inset-block-end: var(--task-gap, 6px);
    border-radius: var(--radius-md);
  }

  .card .task {
    --grip-room: calc(var(--row-pad) + var(--space-2));
    padding-inline-start: calc(var(--grip-room) + var(--depth) * var(--row-indent));
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--line);
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      opacity var(--dur-base) var(--ease-out),
      translate var(--dur-base) var(--ease-out);
  }

  .card .task::after {
    content: none;
  }

  @media (hover: hover) {
    .card .task:hover {
      background: var(--surface-hover);
      box-shadow:
        inset 0 0 0 1px var(--line-strong),
        var(--shadow-sm);
    }
  }

  .card .task.is-on {
    background: var(--surface-selected);
  }

  .card .task.is-picked {
    background: var(--accent-soft);
  }

  .card .grip {
    inset-inline-start: calc(var(--depth) * var(--row-indent) + var(--space-1) - 1px);
    top: calc(var(--card-pad) + (var(--task-head, var(--row-height)) - var(--icon-md)) / 2);
    width: var(--row-pad);
  }

  .task.is-picked {
    background: var(--accent-soft);
  }

  .task:global(.is-swiping) {
    background: var(--bg);
    transition: none;
  }

  .head {
    position: relative;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--task-head, var(--row-height));
    min-width: 0;
  }

  .grip {
    position: absolute;
    inset-inline-start: calc(var(--depth) * var(--row-indent) - 2px);
    top: calc((var(--task-head, var(--row-height)) - var(--icon-md)) / 2);
    display: grid;
    place-items: center;
    width: var(--row-pad);
    height: var(--icon-md);
    color: var(--muted);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .task:hover .grip {
      opacity: 0.7;
    }
  }

  :global([data-touch]) .grip {
    display: none;
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
    position: absolute;
    inset-inline-end: 0;
    top: 50%;
    flex: none;
    display: flex;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    translate: 0 -50%;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .task:hover .actions,
  .task.is-on .actions,
  .task:focus-within .actions {
    position: static;
    translate: none;
    opacity: 1;
    pointer-events: auto;
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

  .finished,
  .blocked {
    opacity: 0.55;
  }

  .finished .words {
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }

  .words {
    transition: color var(--dur-base) var(--ease-out);
  }

  .task:not(.finished):has(:global(.box.done)) {
    opacity: 0.6;
  }

  .task:not(.finished):has(:global(.box.done)) .words {
    color: var(--muted-strong);
    text-decoration: line-through;
    text-decoration-color: var(--line-strong);
  }

  .task:global(.is-carried) {
    opacity: 0.35;
  }

  .toned,
  .card .task.toned {
    background: color-mix(in srgb, var(--row-tone) 14%, var(--bg));
  }
</style>
