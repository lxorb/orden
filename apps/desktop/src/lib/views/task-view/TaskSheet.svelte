<script lang="ts">
  /** A task, whole (Todoist's task view in nib's shapes): where it lives, its box and its
   *  words, its description in the editor every note is written in, its sub-tasks, and a
   *  column of what it is - its note, its day, its deadline, its priority, its labels and
   *  its reminders - each a press away from being changed. The arrows walk the list it
   *  was opened from; ⋯ is the row's own menu.
   *
   *  It reads the task from the rows store as the store changes and writes through the
   *  views' one write path, so every edit is one edit of the note and one undo, and the
   *  note open in a pane beside it changes as it is written. A layer over the window; a
   *  page of its own on a phone. */
  import type { Priority, Row } from '@nib/bases'
  import { parseQuickAdd } from '@nib/bases/language'
  import { linesOf } from '@nib/bases/tasks'
  import { dayWords } from '@nib/editor/task-days'
  import Bell from 'lucide/dist/esm/icons/bell.mjs'
  import Calendar from 'lucide/dist/esm/icons/calendar-days.mjs'
  import ChevronDown from 'lucide/dist/esm/icons/chevron-down.mjs'
  import ChevronUp from 'lucide/dist/esm/icons/chevron-up.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import Flag from 'lucide/dist/esm/icons/flag.mjs'
  import Hash from 'lucide/dist/esm/icons/hash.mjs'
  import NoteIcon from 'lucide/dist/esm/icons/file-text.mjs'
  import Plus from 'lucide/dist/esm/icons/plus.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import Target from 'lucide/dist/esm/icons/target.mjs'
  import { onMount, tick, untrack } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fade, fly } from 'svelte/transition'
  import { closeOnBack } from '../../backstack.svelte'
  import Cross from '../../Cross.svelte'
  import { i18n, t } from '../../i18n.svelte'
  import { menu } from '../../menu.svelte'
  import { LAYER } from '../../motion'
  import { overlays } from '../../overlays'
  import Glyph from '../../quick-add/Glyph.svelte'
  import { durationLabel, priorityTone, remindLabel } from '../../quick-add/labels'
  import { remindRows } from '../../quick-add/pickers'
  import { rows } from '../../rows/rows.svelte'
  import { viewport } from '../../viewport.svelte'
  import { addSubtask, writeRow } from '../act'
  import { notePath } from '../kit'
  import { hasMeta, lineCount, subtaskCounts, taskKey } from '../task-meta'
  import {
    labelEntries,
    priorityEntries,
    scheduleDeadline,
    scheduleRows,
    taskMenu,
  } from '../task-actions'
  import TaskBox from '../TaskBox.svelte'
  import TaskRow from '../TaskRow.svelte'
  import Comments from './Comments.svelte'
  import Description from './Description.svelte'
  import { rowFor, type Shown, viewing } from './viewing.svelte'

  const { shown }: { shown: Shown } = $props()

  const kit = $derived(shown.kit)
  let all = $state.raw<readonly Row[]>(untrack(() => rows.of(shown.ref.space)))
  $effect(() =>
    untrack(() =>
      rows.watch((change) => {
        if (change.space === viewing.shown?.ref.space) all = rows.of(change.space)
      }),
    ),
  )
  $effect(() => {
    const space = shown.ref.space
    untrack(() => (all = rows.of(space)))
  })

  const row = $derived(rowFor(shown.ref, all))
  const task = $derived(row?.task)
  const path = $derived(row ? notePath(row) : null)
  const phone = $derived(viewport.device === 'phone')
  const today = $derived(kit.live.today)

  // A task that is gone (deleted here or in its note) takes its view with it.
  $effect(() => {
    if (!row) untrack(() => viewing.close())
  })

  /** Its sub-tasks, in the order they are written. */
  const children = $derived(
    row?.anchor
      ? all.filter(
          (one) =>
            one.task?.parent === row.anchor?.line &&
            one.space === row.space &&
            one.path === row.path,
        )
      : [],
  )
  const counts = $derived(subtaskCounts(all))
  /** Its parent, for the breadcrumb, where it is a sub-task. */
  const parent = $derived(
    task?.parent === undefined || !row
      ? null
      : (all.find(
          (one) =>
            one.anchor?.line === task.parent && one.path === row.path && one.space === row.space,
        ) ?? null),
  )
  const subKit = $derived({ ...kit, openTask: (one: Row) => viewing.open(one) })

  /** The task's words while they are being changed, written on Enter or when the field
   *  is left. */
  let title = $state('')
  let editing = $state(false)
  $effect(() => {
    const words = task?.text ?? ''
    if (!editing) untrack(() => (title = words))
  })

  function rename() {
    editing = false
    const words = title.trim()
    if (!row || !task || !words || words === task.text) return
    viewing.renamed(words, row.anchor?.line ?? shown.ref.line)
    void writeRow(row, { task: { text: words } })
  }

  let adding = $state(false)
  let subtask = $state('')
  let subField = $state<HTMLInputElement>()
  /** The comments, whose field `c` gives the keyboard to. */
  let comments = $state<{ focus: () => void }>()
  $effect(() => {
    const field = comments
    if (shown.comment && field) untrack(() => field.focus())
  })

  async function writeSubtask() {
    const words = subtask.trim()
    if (!words || !row) return
    subtask = ''
    const read = parseQuickAdd(words, [i18n.language], new Date())
    const [line] = linesOf({ text: read.text || words, fields: read.fields })
    if (line) await addSubtask(row, line)
  }

  const anchorNow = () => row?.anchor ?? null

  let layer = $state<HTMLElement>()

  onMount(() => {
    const before = document.activeElement
    void tick().then(() => layer?.focus())
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true })
    }
  })
  $effect(() => closeOnBack(true, () => viewing.close()))
  $effect(() => overlays.show(() => viewing.close()))

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      viewing.close()
      return
    }
    const target = event.target
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, [contenteditable], .cm-editor')
    ) {
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey || !row || !task) return
    const box = layer?.querySelector('.when')
    switch (event.key) {
      case 'ArrowUp':
      case 'k':
        event.preventDefault()
        viewing.step(-1)
        return
      case 'ArrowDown':
      case 'j':
        event.preventDefault()
        viewing.step(1)
        return
      case 'e':
        event.preventDefault()
        kit.tick(row)
        return
      case 'c':
        event.preventDefault()
        comments?.focus()
        return
      case 't':
        event.preventDefault()
        if (box) scheduleRows([row], box, kit)
        return
      default: {
        const priority = PRIORITY_KEYS[event.key]
        if (priority === undefined) return
        event.preventDefault()
        void writeRow(row, { task: { priority } })
      }
    }
  }

  const PRIORITY_KEYS: Partial<Record<string, Priority>> = { 1: 1, 2: 2, 3: 3, 4: 4 }

  function priorityMenu(event: MouseEvent) {
    if (!row || !task) return
    const current = row
    menu.show(
      event,
      priorityEntries(task.priority, (priority) => void writeRow(current, { task: { priority } })),
    )
  }

  /** The labels a task can be given: every tag the space's tasks carry, its own ticked. */
  function labelMenu(event: MouseEvent) {
    if (!row) return
    const tags = labelEntries([row])
    if (!tags.length) {
      labelling = true
      void tick().then(() => labelField?.focus())
      return
    }
    menu.show(event, [
      ...tags,
      null,
      {
        label: t('New label'),
        asks: true,
        run: () => {
          labelling = true
          void tick().then(() => labelField?.focus())
        },
      },
    ])
  }

  let labelling = $state(false)
  let label = $state('')
  let labelField = $state<HTMLInputElement>()

  function writeLabel() {
    const tag = label.trim().replace(/^[#@%]+/, '')
    labelling = false
    label = ''
    if (!tag || /\s/.test(tag) || !row || !task || task.tags.includes(tag)) return
    void writeRow(row, { task: { tags: [...task.tags, tag] } })
  }

  function remindMenu(event: MouseEvent) {
    if (!row || !task) return
    const current = row
    const day = task.due ?? task.scheduled
    menu.show(
      event,
      remindRows(
        task.remind,
        { due: day, time: task.time },
        today,
        (remind) => void writeRow(current, { task: { remind } }),
      ),
    )
  }

  function moreMenu(event: MouseEvent) {
    if (row) taskMenu(event, [row], kit)
  }

  /** A sub-task's own sub-tasks, counted. */
  const countsOf = (one: Row) => counts.get(taskKey(one.space, one.path, one.anchor?.line ?? -1))

  /** How many lines a sub-task's row is. */
  function lineOf(one: Row): number {
    const sub = one.task
    return sub ? lineCount(sub, hasMeta(sub, true, countsOf(one)), false) : 1
  }
</script>

<div
  class="nib-scrim scrim"
  role="presentation"
  onpointerdown={() => viewing.close()}
  transition:fade={{ duration: LAYER.fade }}
></div>
<div
  bind:this={layer}
  class="nib-screen sheet"
  class:page={phone}
  role="dialog"
  aria-modal="true"
  aria-label={task?.text ?? ''}
  tabindex="-1"
  {onkeydown}
  transition:fly={{ y: phone ? 24 : 8, duration: LAYER.rise, easing: cubicOut }}
>
  {#if row && task}
    <header class="head">
      <button
        type="button"
        class="crumbs"
        onclick={() => {
          viewing.close()
          kit.open(row, 'aside')
        }}
      >
        <Glyph icon={NoteIcon} />
        <span class="crumb">{row.file.basename}</span>
        {#if task.section.length}<span class="sep" aria-hidden="true">›</span><span class="crumb"
            >{task.section.at(-1)}</span
          >{/if}
      </button>
      {#if parent?.task}
        <span class="sep" aria-hidden="true">›</span>
        <button type="button" class="crumbs" onclick={() => viewing.open(parent)}>
          <span class="crumb">{parent.task.text}</span>
        </button>
      {/if}
      <span class="gap"></span>
      <button
        type="button"
        class="nib-glyph"
        aria-label={t('Previous')}
        disabled={!viewing.can(-1)}
        onclick={() => viewing.step(-1)}><Glyph icon={ChevronUp} /></button
      >
      <button
        type="button"
        class="nib-glyph"
        aria-label={t('Next')}
        disabled={!viewing.can(1)}
        onclick={() => viewing.step(1)}><Glyph icon={ChevronDown} /></button
      >
      <button type="button" class="nib-glyph" aria-label={t('More')} onclick={moreMenu}
        ><Glyph icon={Ellipsis} /></button
      >
      <button
        type="button"
        class="nib-glyph"
        aria-label={t('Close')}
        onclick={() => viewing.close()}><Cross /></button
      >
    </header>

    <div class="body">
      <section class="main">
        <div class="title-line">
          <TaskBox {task} label={task.text} ontick={() => kit.tick(row)} />
          <input
            class="title"
            class:finished={task.done || task.cancelled}
            bind:value={title}
            aria-label={t('Task')}
            onfocus={() => (editing = true)}
            onblur={rename}
            onkeydown={(event) => {
              if (event.key === 'Enter' && !event.isComposing) {
                event.preventDefault()
                event.currentTarget.blur()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                title = task.text
                editing = false
                event.currentTarget.blur()
              }
            }}
          />
        </div>

        {#if path}
          {#key `${shown.ref.path}\n${shown.ref.line}`}
            <div class="words"><Description {path} anchor={anchorNow} /></div>
          {/key}
        {/if}

        <div class="subtasks">
          {#if children.length}
            <p class="nib-section">
              {t('Sub-tasks')}
              <span class="count"
                >{children.filter((one) => one.task?.done).length}/{children.length}</span
              >
            </p>
          {/if}
          {#each children as child (child.anchor?.line)}
            <TaskRow
              row={child}
              kit={subKit}
              lines={lineOf(child)}
              where={false}
              subtasks={countsOf(child)}
            />
          {/each}
          {#if adding}
            <div class="nib-row adding">
              <Glyph icon={Plus} />
              <!-- svelte-ignore a11y_autofocus -->
              <input
                bind:this={subField}
                bind:value={subtask}
                class="field"
                autofocus
                aria-label={t('Add sub-task')}
                placeholder={t('Add sub-task')}
                onkeydown={(event) => {
                  if (event.isComposing) return
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void writeSubtask()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    adding = false
                    subtask = ''
                  }
                }}
                onblur={() => {
                  if (!subtask.trim()) adding = false
                }}
              />
            </div>
          {:else}
            <button
              type="button"
              class="nib-row adder"
              onclick={() => {
                adding = true
                void tick().then(() => subField?.focus())
              }}
            >
              <span class="nib-row-mark"><Glyph icon={Plus} /></span>
              <span class="nib-row-label">{t('Add sub-task')}</span>
            </button>
          {/if}
        </div>

        {#if path && row}
          {#key `${shown.ref.path}
${shown.ref.line}`}
            <Comments bind:this={comments} {row} {path} />
          {/key}
        {/if}
      </section>

      <aside class="side">
        <p class="nib-section">{t('Note')}</p>
        <button
          type="button"
          class="nib-row is-short"
          onclick={() => {
            viewing.close()
            kit.open(row, 'aside')
          }}
        >
          <span class="nib-row-mark"><Glyph icon={NoteIcon} /></span>
          <span class="nib-row-label">{row.file.basename}</span>
        </button>

        <p class="nib-section">{t('Date')}</p>
        <button
          type="button"
          class="nib-row is-short when"
          onclick={(event) => scheduleRows([row], event.currentTarget, kit)}
        >
          <span class="nib-row-mark"><Glyph icon={task.recurrence ? Repeat : Calendar} /></span>
          <span class="nib-row-label" class:late={(task.due ?? task.scheduled ?? today) < today}
            >{#if task.due ?? task.scheduled}{dayWords(
                task.due ?? task.scheduled ?? today,
                today,
                task.time,
              )}{#if task.duration !== undefined}
                · {durationLabel(task.duration)}{/if}{:else}{t('No date')}{/if}</span
          >
        </button>
        {#if task.recurrence}<p class="rule">{task.recurrence}</p>{/if}

        <p class="nib-section">{t('Deadline')}</p>
        <button
          type="button"
          class="nib-row is-short"
          onclick={(event) => scheduleDeadline(row, event.currentTarget, kit)}
        >
          <span class="nib-row-mark"><Glyph icon={Target} /></span>
          <span class="nib-row-label" class:late={!!task.deadline && task.deadline <= today}
            >{task.deadline ? dayWords(task.deadline, today) : t('No deadline')}</span
          >
        </button>

        <p class="nib-section">{t('Priority')}</p>
        <button type="button" class="nib-row is-short" onclick={priorityMenu}>
          <span class="nib-row-mark" style:color={priorityTone(task.priority)}
            ><Glyph icon={Flag} /></span
          >
          <span class="nib-row-label">p{Math.min(task.priority, 4)}</span>
        </button>

        <p class="nib-section">{t('Labels')}</p>
        <div class="tags">
          {#each task.tags as tag (tag)}
            <span class="nib-chip tag"
              >#{tag}<button
                type="button"
                class="untag"
                aria-label={t('Remove')}
                onclick={() =>
                  void writeRow(row, {
                    task: { tags: task.tags.filter((one) => one !== tag) },
                  })}><Cross small /></button
              ></span
            >
          {/each}
          {#if labelling}
            <input
              bind:this={labelField}
              bind:value={label}
              class="tag-field"
              aria-label={t('New label')}
              placeholder={t('New label')}
              onkeydown={(event) => {
                if (event.key === 'Enter' && !event.isComposing) {
                  event.preventDefault()
                  writeLabel()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  labelling = false
                  label = ''
                }
              }}
              onblur={writeLabel}
            />
          {:else}
            <button
              type="button"
              class="nib-glyph add-tag"
              aria-label={t('Labels')}
              onclick={labelMenu}><Glyph icon={Hash} /></button
            >
          {/if}
        </div>

        <p class="nib-section">{t('Reminders')}</p>
        <button type="button" class="nib-row is-short" onclick={remindMenu}>
          <span class="nib-row-mark"><Glyph icon={Bell} /></span>
          <span class="nib-row-label"
            >{task.remind.length
              ? task.remind.map((one) => remindLabel(one, today)).join(', ')
              : t('None')}</span
          >
        </button>
      </aside>
    </div>
  {/if}
</div>

<style>
  .scrim {
    --scrim-z: var(--z-sheet);
  }

  /* The screen's own shape and place (base.css), two things side by side wide. */
  .sheet {
    --screen-width: var(--screen-pair);
    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    outline: none;
    font-family: var(--font-ui);
  }

  .sheet.page {
    inset: 0;
    width: auto;
    max-height: none;
    border: none;
    border-radius: 0;
    translate: none;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--header-height, var(--row-height));
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--line);
  }

  .crumbs {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    padding: 2px var(--space-1);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-sm);
  }

  @media (hover: hover) {
    .crumbs:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .crumb {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 14em;
  }

  .sep {
    color: var(--muted);
  }

  .gap {
    flex: 1;
  }

  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 14rem;
    overflow: hidden;
  }

  .page .body {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .main {
    min-width: 0;
    padding: var(--space-3) var(--space-4) var(--space-4);
    overflow-y: auto;
  }

  .title-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .title {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    outline: none;
  }

  .title.finished {
    text-decoration: line-through;
    color: var(--muted);
  }

  .words {
    margin: var(--space-2) 0 var(--space-3) calc(20px + var(--space-2));
  }

  .subtasks {
    display: flex;
    flex-direction: column;
  }

  .count {
    margin-inline-start: var(--space-1);
    font-variant-numeric: tabular-nums;
  }

  .adder,
  .adding {
    color: var(--muted);
  }

  .field,
  .tag-field {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
    outline: none;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-2);
    overflow-y: auto;
    border-inline-start: 1px solid var(--line);
    background: var(--surface);
  }

  .page .side {
    border-inline-start: none;
    border-top: 1px solid var(--line);
  }

  .side .nib-section {
    margin: var(--space-2) 0 0;
    padding-inline: var(--row-pad);
  }

  .late {
    color: var(--danger);
  }

  .rule {
    margin: 0;
    padding: 0 var(--row-pad) 0 calc(var(--row-pad) + var(--icon-md) + var(--row-gap));
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    padding: 2px var(--row-pad);
  }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .untag {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
  }

  .add-tag {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .tag-field {
    min-width: 6em;
    font-size: var(--text-sm);
  }
</style>
