<script lang="ts">
  /** The list layout: the view's groups, each a head with its count and its rows, the
   *  sub-tasks under their parents, and an add row at the end (docs/tasks.md 5.9).
   *
   *  A task is Todoist's row of up to three lines (TaskRow.svelte), and how many is
   *  arithmetic over what it carries (task-meta.ts), so the list still keeps a window
   *  of what is on screen without measuring a row: a Logbook of ten thousand lines
   *  mounts thirty (`Heights`, the chat's own). The three heights a line can be are
   *  read off a probe once, and again when the box is resized. The keyboard walks the
   *  rows and every key of row-keys.ts works on the one it is on, or on every one
   *  selected (x, Ctrl or Shift and a press), with the bulk bar at the foot of the list
   *  for the same with a pointer. In a project grouped by its sections each head has the
   *  section's menu (section-actions.ts) and the list ends in Add section; which groups
   *  are folded is kept on this device (kept-views.ts). A row carried onto
   *  another group is written into it; onto another task of its own note, it moves its
   *  lines there. */
  import { groupName, type Row, rowId, type Value } from '@nib/bases'
  import { untrack } from 'svelte'
  import { Heights } from '../chats/view/window'
  import { without } from '../records'
  import { t } from '../i18n.svelte'
  import { ListView, tokenRow } from '../row-window.svelte'
  import Twist from '../Twist.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import { samePath } from '../space-paths'
  import { viewport } from '../viewport.svelte'
  import { moveBeside } from './act'
  import AddRow from './AddRow.svelte'
  import BulkBar from './BulkBar.svelte'
  import { droppable, type Point } from './drag.svelte'
  import type { Kit } from './kit'
  import {
    EMPTY,
    listItems,
    toggled,
    withEveryDay,
    withEverySection,
    withPicked,
  } from './list-items'
  import { parentOf } from './columns'
  import { rowKey } from './row-keys'
  import { foldsOf, keepFolds, viewKey } from './kept-views'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import Glyph from '../quick-add/Glyph.svelte'
  import {
    addSection,
    projectOf,
    renameSection,
    sectionMenu,
    sectionsHere,
  } from './section-actions'
  import { focusSoon } from './focus-soon'
  import './task-keys'
  import RowLine from './RowLine.svelte'
  import { runKey, scheduleRows } from './task-actions'
  import { hasMeta, lineCount, subtaskCounts, taskKey } from './task-meta'
  import TaskRow from './TaskRow.svelte'
  import { dayHead, groupLabel } from './words'

  const {
    kit,
    dated = true,
    where = true,
    days,
    onnearend,
    reveal,
  }: {
    kit: Kit
    /** Whether a row says its date: not where the groups are the days. */
    dated?: boolean
    /** Whether a row says which note it is in: not in a project's own view. */
    where?: boolean
    /** Every day from one through another drawn, empty ones too: Upcoming. */
    days?: { from: string; through: string } | undefined
    /** Told when the rows drawn come near the end of the list, for one that grows. */
    onnearend?: (() => void) | undefined
    /** An item to scroll to the top, and a count that says each new ask (AddRow's
     *  `asked`). */
    reveal?: { id: string; asked: number } | undefined
  } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const property = $derived(view?.groupBy?.property)

  /** Groups folded, and parents whose sub-tasks are folded: replaced whole on each
   *  press (`toggled`), so plain state is all they need. The groups are as the view was
   *  left on this device. */
  const kept = untrack(() => viewKey(kit.spec, kit.file))
  let folded = $state.raw<ReadonlySet<string>>(untrack(() => foldsOf(kept)))
  function fold(name: string) {
    folded = toggled(folded, name)
    keepFolds(kept, folded)
  }
  /** The project the view is of, grouped by its sections: the heads are its sections. */
  const project = $derived(property === 'task.section' ? projectOf(kit) : null)
  /** The section whose head is a field, being named again; the field at the end, open. */
  let renaming = $state<string | null>(null)
  let naming = $state(false)
  let shut = $state.raw<ReadonlySet<string>>(EMPTY)
  let selected = $state<string | null>(null)
  /** The row whose task is being changed in its own field, Todoist's inline editor. */
  let editing = $state<string | null>(null)
  /** The rows selected, by item, and the one a Shift and a press counts from. */
  let picked = $state.raw<ReadonlySet<string>>(EMPTY)
  let pickedFrom: string | null = null
  /** The add row Q asked for, by group name, and how many times; see AddRow's `asked`. */
  let adding = $state({ group: '', count: 0 })

  const items = $derived(
    listItems(
      days
        ? withEveryDay(live.answer?.groups ?? [], days.from, days.through)
        : project
          ? withEverySection(
              live.answer?.groups ?? [],
              sectionsHere(project.relative),
              project.name,
            )
          : (live.answer?.groups ?? []),
      {
        grouped: property !== undefined,
        bareNone: property === 'task.section',
        ...(project ? { title: project.name } : {}),
        folded,
        shut,
        hidden: view?.nib.hidden ?? [],
        adding: true,
        parentOf: (row) => parentOf(row, live.context),
      },
    ),
  )
  const rows = $derived(items.flatMap((item) => (item.kind === 'row' ? [item] : [])))
  /** The rows selected that are still in the list: a task completed out of it goes. */
  const pickedRows = $derived(picked.size ? rows.filter((one) => picked.has(one.id)) : [])

  /** A row selected or let go; `range` selects every row from the last one pressed. */
  function pick(id: string, range: boolean) {
    const order = rows.map((one) => one.id)
    picked = withPicked(picked, order, id, range ? pickedFrom : null)
    pickedFrom = id
  }

  /** Enter writes a field's words, Escape leaves them; either way the field goes. */
  function named(event: KeyboardEvent, write: (words: string) => void) {
    event.stopPropagation()
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    const field = event.currentTarget
    const words = field instanceof HTMLInputElement ? field.value : ''
    renaming = null
    naming = false
    if (event.key === 'Enter' && words.trim()) write(words)
  }

  function unpick() {
    picked = EMPTY
    pickedFrom = null
  }

  /** Every task's sub-tasks, counted over all the rows the view is over. */
  const subtasks = $derived(subtaskCounts(live.rows))
  const countsOf = (row: Row) =>
    row.anchor ? subtasks.get(taskKey(row.space, row.path, row.anchor.line)) : undefined

  /** How many lines each item is drawn on: a task as many as it has things to say,
   *  everything else one. */
  const lines = $derived(
    items.map((item) => {
      const task = item.kind === 'row' ? item.row.task : undefined
      if (!task || item.kind !== 'row') return 1
      return lineCount(task, hasMeta(task, dated, countsOf(item.row)), where)
    }),
  )

  let list = $state<HTMLElement>()
  let probe = $state<HTMLElement>()
  /** The three heights a task's lines come in, read off the probe. */
  let pitch = $state({ head: 28, line: 18, foot: 6 })
  const win = new ListView()
  $effect(() => {
    const box = list
    if (!box) return
    const touch = viewport.touch
    return untrack(() =>
      win.follow(box, () => {
        const [head, line, foot] = [...(probe?.children ?? [])].map((one) =>
          one instanceof HTMLElement ? one.offsetHeight : 0,
        )
        if (head && line && foot !== undefined) pitch = { head, line, foot }
        return tokenRow(touch)
      }),
    )
  })

  /** How much taller than its row an item is drawn while a field stands in it: the one
   *  height measured, the editor's, so the rows under it make room as Todoist's do. */
  let grown = $state.raw<Record<string, number>>({})
  function grow(id: string, by: number) {
    const now = Math.max(0, Math.round(by))
    if ((grown[id] ?? 0) === now) return
    grown = now ? { ...grown, [id]: now } : without(grown, id)
  }

  /** How tall an item is drawn at rest. */
  function restingHeight(item: (typeof items)[number], many: number): number {
    const row = win.row || 28
    const { head, line, foot } = pitch
    if (item.kind !== 'row' || !item.row.task) return row
    return head + (many - 1) * line + (many > 1 ? foot : 0)
  }

  const heights = $derived.by(
    () =>
      new Heights(
        items.map((item, at) => restingHeight(item, lines[at] ?? 1) + (grown[item.id] ?? 0)),
      ),
  )
  // A list that grows is told as its end comes into the window, not before.
  $effect(() => {
    if (onnearend && items.length && shown.last >= items.length - 12) untrack(onnearend)
  })

  /** Scrolls an item to the top of the box the list scrolls in, whether it is drawn
   *  yet or not: where it is is arithmetic. */
  function scrollTo(id: string): void {
    const at = items.findIndex((item) => item.id === id)
    const box = win.box
    if (at === -1 || !box || !list) return
    const above = list.getBoundingClientRect().top - box.getBoundingClientRect().top
    box.scrollTo({ top: box.scrollTop + above + heights.top(at), behavior: 'smooth' })
  }

  $effect(() => {
    const asked = reveal
    if (asked && asked.asked > 0) untrack(() => scrollTo(asked.id))
  })

  const shown = $derived.by(() => {
    const span = heights.span(win.top, win.room || 600, 8 * (win.row || 28))
    return {
      first: span.from,
      last: span.to - 1,
      above: heights.top(span.from),
      below: Math.max(0, heights.total - heights.top(span.to)),
    }
  })

  /** A row let go over another row: within its own note, its lines move beside that
   *  one's; anywhere else, it joins that row's group. */
  function landOnRow(target: Row, key: Value, carried: Row, at: Point, box: HTMLElement) {
    if (carried === target) return
    const rect = box.getBoundingClientRect()
    const after = at.y > rect.top + rect.height / 2
    const sameNote = carried.space === target.space && samePath(carried.path, target.path)
    if (carried.task && target.task && sameNote && property !== 'formula.overdue') {
      const sameGroup = groupOf(carried) === groupName(key)
      if (sameGroup || property === undefined || property === 'task.section') {
        void moveBeside(carried, target, after)
        return
      }
    }
    if (property !== undefined) kit.drop(carried, key)
  }

  function groupOf(row: Row): string | null {
    const found = rows.find((one) => one.row === row)
    return found ? groupName(found.group.key) : null
  }

  function keydown(event: KeyboardEvent) {
    const key = rowKey(event, (id) => shortcuts.keyFor(id), shortcuts.platform)
    if (!key) return
    const at = rows.findIndex((one) => one.id === selected)
    if (key.kind === 'unpick') {
      if (!picked.size) return
      event.preventDefault()
      unpick()
      return
    }
    const here = rows[at]
    if (key.kind === 'pick' || key.kind === 'fold') {
      if (!here) return
      event.preventDefault()
      if (key.kind === 'pick') pick(here.id, false)
      else if (here.twist) shut = toggled(shut, rowId(here.row))
      return
    }
    if (key.kind === 'add') {
      event.preventDefault()
      const adds = items.filter((item) => item.kind === 'add')
      const row = rows[at]
      const end = key.where === 'end' ? adds.at(-1) : key.where === 'top' ? adds[0] : undefined
      const name =
        end?.kind === 'add'
          ? end.group
            ? groupName(end.group.key)
            : ''
          : row
            ? groupName(row.group.key)
            : ''
      adding = { group: name, count: adding.count + 1 }
      return
    }
    if (key.kind === 'edit') {
      event.preventDefault()
      editing = rows[at]?.id ?? null
      return
    }
    if (key.kind === 'step') {
      event.preventDefault()
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + key.by))]
      if (next) select(next.id)
      return
    }
    if (!here) return
    const many = pickedRows.length ? pickedRows.map((one) => one.row) : [here.row]
    const box = list?.querySelector(`[data-item="${CSS.escape(here.id)}"]`)?.getBoundingClientRect()
    if (!box || !runKey(kit, many, key, box)) return
    event.preventDefault()
    if (key.kind === 'tick' || key.kind === 'delete') unpick()
  }

  function select(id: string) {
    selected = id
    queueMicrotask(() =>
      list?.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"] [role=option]`)?.focus(),
    )
  }

  /** Where the keyboard's row was, so a row that leaves the list - completed out of
   *  Today, its date taken away - hands the keyboard to the one that takes its place,
   *  as Todoist's does, rather than to nothing, where no key of the view is heard. */
  let selectedAt = 0
  $effect(() => {
    const now = rows
    untrack(() => {
      if (selected === null) return
      const at = now.findIndex((one) => one.id === selected)
      if (at !== -1) {
        selectedAt = at
        return
      }
      const next = now[Math.min(selectedAt, now.length - 1)]
      const held = document.activeElement
      const lost = !held || held === document.body || (list?.contains(held) ?? false)
      if (next && lost) select(next.id)
      else if (!next) selected = null
    })
  })
</script>

<div
  class="list"
  bind:this={list}
  role="listbox"
  tabindex={selected === null ? 0 : -1}
  aria-label={view?.name ?? ''}
  onkeydown={keydown}
  onfocus={(event) => {
    if (event.target === event.currentTarget && rows[0]) select(rows[0].id)
  }}
  style:padding-top="{shown.above}px"
  style:padding-bottom="{shown.below}px"
>
  <div class="probe" bind:this={probe} aria-hidden="true">
    <div class="probe-head"></div>
    <div class="probe-line"></div>
    <div class="probe-foot"></div>
  </div>
  {#each items.slice(shown.first, shown.last + 1) as item, index (item.id)}
    <div
      class="item"
      data-item={item.id}
      style:padding-bottom={grown[item.id] ? `${grown[item.id]}px` : undefined}
    >
      {#if item.kind === 'head'}
        {@const name = groupName(item.group.key)}
        {@const section = project && typeof item.group.key === 'string' ? item.group.key : null}
        <div class="nib-section head" use:droppable={(row) => kit.drop(row, item.group.key)}>
          {#if section !== null && renaming === section}
            <input
              class="nib-field naming"
              value={section}
              aria-label={t('Rename')}
              use:focusSoon
              onkeydown={(event) => named(event, (words) => renameSection(kit, section, words))}
              onblur={(event) => {
                if (renaming === section) renameSection(kit, section, event.currentTarget.value)
                renaming = null
              }}
            />
          {:else}
            <button
              type="button"
              class="fold"
              aria-expanded={!item.folded}
              onclick={() => fold(name)}
              oncontextmenu={(event) => {
                if (section === null) return
                event.preventDefault()
                sectionMenu(event, kit, section, item.count, () => (renaming = section))
              }}
            >
              <span class="twist"><Twist open={!item.folded} /></span>
              {days
                ? dayHead(item.group.key, live.today)
                : groupLabel(property, item.group.key, live.today)}
              {#if item.count}<span class="count">{item.count}</span>{/if}
            </button>
          {/if}
          {#if section !== null && renaming !== section}
            <button
              type="button"
              class="more"
              tabindex="-1"
              aria-label={t('More')}
              title={t('More')}
              onclick={(event) =>
                sectionMenu(event, kit, section, item.count, () => (renaming = section))}
              ><Glyph icon={Ellipsis} /></button
            >
          {/if}
          {#if ((property === 'formula.overdue' && item.group.key === true) || item.group.key === 'overdue') && item.count}
            <button
              type="button"
              class="nib-chip is-quiet act"
              onclick={(event) => scheduleRows(item.group.rows, event.currentTarget, kit)}
              >{t('Reschedule')}</button
            >
          {/if}
        </div>
      {:else if item.kind === 'row'}
        {@const row = item.row}
        {@const key = item.group.key}
        <div
          class="drop"
          use:droppable={(carried, at, box) => landOnRow(row, key, carried, at, box)}
        >
          {#if row.task}
            <TaskRow
              {row}
              {kit}
              {dated}
              {where}
              lines={lines[shown.first + index] ?? 1}
              editing={editing === item.id}
              onedit={(on) => {
                editing = on ? item.id : null
                if (!on) grow(item.id, 0)
              }}
              onsize={(tall) =>
                grow(item.id, tall - restingHeight(item, lines[shown.first + index] ?? 1))}
              subtasks={countsOf(row)}
              depth={item.depth}
              twist={item.twist}
              ontwist={() => (shut = toggled(shut, rowId(row)))}
              selected={selected === item.id}
              onselect={() => (selected = item.id)}
              picked={picked.has(item.id)}
              picking={picked.size > 0}
              onpick={(range: boolean) => pick(item.id, range)}
            />
          {:else}
            <RowLine
              {row}
              {kit}
              {dated}
              {where}
              depth={item.depth}
              twist={item.twist}
              ontwist={() => (shut = toggled(shut, rowId(row)))}
              selected={selected === item.id}
              onselect={() => (selected = item.id)}
            />
          {/if}
        </div>
      {:else}
        <AddRow
          {kit}
          group={item.group}
          asked={adding.group === (item.group ? groupName(item.group.key) : '') ? adding.count : 0}
          onsize={(tall) => grow(item.id, tall ? tall - (win.row || 28) : 0)}
        />
      {/if}
    </div>
  {/each}
  {#if project}
    {#if naming}
      <input
        class="nib-field naming end"
        placeholder={t('Section')}
        aria-label={t('Add section')}
        use:focusSoon
        onkeydown={(event) => named(event, (words) => addSection(kit, words))}
        onblur={(event) => {
          if (naming) addSection(kit, event.currentTarget.value)
          naming = false
        }}
      />
    {:else}
      <button type="button" class="add-section" onclick={() => (naming = true)}>
        <span class="rule" aria-hidden="true"></span>{t('Add section')}<span
          class="rule"
          aria-hidden="true"
        ></span>
      </button>
    {/if}
  {/if}
</div>
{#if pickedRows.length}
  <BulkBar rows={pickedRows.map((one) => one.row)} {kit} onclear={unpick} />
{/if}

<style>
  /* A task's three heights: the line of its words, each line under them, and the room
     under the last. Read back by the probe, so the arithmetic and the drawing are one
     number each. */
  .list {
    --task-head: var(--row-height);
    --task-line: 18px;
    --task-foot: 6px;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding-inline: var(--space-2);
  }

  :global([data-touch]) .list {
    --task-head: var(--touch-target);
    --task-line: 22px;
    --task-foot: 8px;
  }

  .probe {
    position: absolute;
    top: 0;
    width: 0;
    height: 0;
    overflow: hidden;
    visibility: hidden;
  }

  .probe-head {
    height: var(--task-head);
  }

  .probe-line {
    height: var(--task-line);
  }

  .probe-foot {
    height: var(--task-foot);
  }

  .item {
    position: relative;
    flex: none;
  }

  .head {
    min-height: var(--row-height);
    margin: 0;
    padding-block: 0;
  }

  .fold {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: default;
  }

  .twist {
    width: 10px;
    height: 10px;
    display: grid;
    color: var(--muted);
  }

  .count {
    color: var(--muted);
    font-weight: var(--weight-row);
    font-variant-numeric: tabular-nums;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .more {
    display: grid;
    place-items: center;
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    margin-inline-start: auto;
    padding: 0;
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .head:hover .more,
  .more:focus-visible {
    opacity: 1;
  }

  :global([data-touch]) .more {
    opacity: 1;
  }

  .naming {
    flex: 1;
    min-width: 0;
  }

  .naming.end {
    flex: none;
    margin: var(--space-3) var(--space-2);
  }

  /* Todoist's line between sections that offers one more: quiet until pointed at. */
  .add-section {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin: var(--space-3) 0;
    padding: var(--space-1) var(--space-2);
    border: none;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    opacity: 0.55;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .add-section:hover,
  .add-section:focus-visible {
    opacity: 1;
  }

  .rule {
    flex: 1;
    height: 1px;
    background: currentColor;
  }

  .act {
    padding-block: 0;
    font-size: var(--text-xs);
    text-transform: none;
    letter-spacing: 0;
  }

  .head:global(.is-taking),
  .drop:global(.is-taking) {
    border-radius: var(--radius-row);
    background: var(--surface-selected);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
</style>
