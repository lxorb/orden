<script lang="ts">
  /** The Tasks panel: the add row, then the open space's Todos - every task of the
   *  space in one view (#1046), its count in the danger tone while something is overdue
   *  - then the favourites (bookmarked notes with tasks and views) and the labels. What
   *  were Inbox, Today, Upcoming, Completed, the filters, the projects and the notes are
   *  the one view's Display menu now.
   *
   *  A press on a row chooses it, and its list is drawn here under the rows; no tab
   *  opens (#374). Ctrl or Cmd and a press, the middle button, or the row's menu opens
   *  it in a tab of its own. Which is which is decided in one place, panel-press.ts.
   *  Moved to the right, beside the note being written, it is the same. */
  import { answer, readBase, type Row } from '@orden/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { links } from '../link-index.svelte'
  import { DIVIDER, menu } from '../menu.svelte'
  import { rows } from '../rows/rows.svelte'
  import { insideSpace } from '../space-paths'
  import { invoke } from '../tauri'
  import { workspace } from '../workspace.svelte'
  import { addTyped, openQuickAdd } from './add'
  import { contextFor } from './context'
  import { todayHere } from './days'
  import { kitFor } from './kit'
  import ListLayout from './ListLayout.svelte'
  import { LiveView } from './live.svelte'
  import { ADD_MARK, LABEL_MARK, PROJECT_MARK, TODAY_MARK, VIEW_MARK } from './marks'
  import { openByPath, panelCounts } from './panel'
  import { choose, openInTab, type PanelRow, sameRow, specOf } from './panel-press'
  import { fileSource, panelSource } from './source'
  import { refusedAsTag } from '../tag-actions'
  import { guardedAt } from './guard'
  import { prompt } from '../prompt.svelte'
  import { canWriteAt } from '../sharing.svelte'
  import { builtinName } from './words'

  /** Which side of the window the panel is on; the same on both, said for its styles. */
  const { side = 'left' }: { side?: 'left' | 'right' } = $props()

  /** Every space's rows as the store last told of a change, which is what counts again. */
  let all = $state.raw<readonly Row[]>(untrack(() => rows.of()))
  let today = $state(todayHere())
  $effect(() =>
    untrack(() =>
      rows.watch(() => {
        all = rows.of()
        today = todayHere()
      }),
    ),
  )
  const counts = $derived(panelCounts(all, today, workspace.activeSpace?.name))

  const space = $derived(workspace.activeSpace)
  const root = $derived(space?.root ?? null)
  /** Whether a task can be added here: not in a space shared to be read. */
  const writes = $derived(root !== null && canWriteAt(root))
  /** Open tasks per note of the open space, by its path in the space. */
  const openIn = $derived(openByPath(counts.notes, space?.name))

  /** The open space's bookmarks that are a note with tasks or a view. */
  const favourites = $derived.by(() => {
    if (root === null || !space) return []
    return workspace.bookmarks.list.flatMap((mark) => {
      if (mark.kind !== 'note') return []
      const path = insideSpace(root, mark.path)
      const isBase = /\.base$/i.test(mark.path)
      const holds = openIn.has(mark.path)
      if (!isBase && !holds) return []
      return [
        {
          path,
          relative: mark.path,
          base: isBase,
          name: mark.path.replace(/^.*\//, '').replace(/\.(md|base)$/i, ''),
          count: isBase ? baseCount(path) : (openIn.get(mark.path) ?? 0),
        },
      ]
    })
  })

  /** Each base file read once, and again when it is written. */
  let read = $state<Record<string, ReturnType<typeof readBase> | null>>({})
  $effect(() => {
    const paths = favourites.filter((one) => one.base).map((one) => one.path)
    untrack(() => {
      for (const path of paths) {
        if (path in read) continue
        void invoke<string>('read_note', { path })
          .then((text) => (read = { ...read, [path]: readBase(text) }))
          .catch(() => (read = { ...read, [path]: null }))
      }
    })
  })
  $effect(() =>
    untrack(() =>
      links.hearSaves((path, text) => {
        if (path in read) read = { ...read, [path]: readBaseOrNull(text) }
      }),
    ),
  )
  const readBaseOrNull = (text: string) => {
    try {
      return readBase(text)
    } catch {
      // A base being written by hand is YAML half the time: it counts nothing until
      // it reads again.
      return null
    }
  }
  function baseCount(path: string): number | null {
    const written = read[path]
    const name = workspace.activeSpace?.name
    const base = written && guardedAt(written, path)
    if (!base || name === undefined) return null
    try {
      const mine = all.filter((one) => one.space === name)
      const said = answer(
        base,
        0,
        mine,
        contextFor({ rows: mine, today, now: `${today}T00:00:00` }),
      )
      // A count of what was read in time is no count of the base.
      return said.partial ? null : said.total
    } catch {
      return null
    }
  }

  /** The row chosen, whose list is drawn under the rows: Todos until another is. */
  let chosen = $state<PanelRow>({ kind: 'todos' })

  /** A row pressed: chosen here, or opened in a tab where that was asked for. */
  function press(event: MouseEvent, row: PanelRow) {
    if (choose(event) === 'tab') {
      event.preventDefault()
      openInTab(row)
    } else chosen = row
  }

  /** The middle button, which a browser gives no click for. */
  function auxPress(event: MouseEvent, row: PanelRow) {
    if (event.button === 1) press(event, row)
  }

  /** A row's menu: Open in new tab first, then what the row itself offers. */
  function rowMenu(event: MouseEvent, row: PanelRow) {
    event.preventDefault()
    if (row.kind === 'label') {
      labelMenu(event, row.tag)
      return
    }
    menu.show(event, [{ label: t('Open in new tab'), run: () => openInTab(row) }])
  }

  let typing = $state(false)
  let words = $state('')

  function add() {
    if (!openQuickAdd()) typing = true
  }

  async function write() {
    const said = words
    if (!said.trim()) return
    words = ''
    // Kept in the field where it was not written, unless more were typed meanwhile.
    if (!(await addTyped(said, {})) && !words) words = said
  }

  /** A label's menu: named again, or taken off every task, in every note of the space,
   *  as one undo (`retagNotes`). */
  function labelMenu(event: MouseEvent, tag: string) {
    // Opened only, in a space shared to be read: renaming or taking a label away writes
    // its notes, which that space refuses (`replaceInNotes` in workspace/note-text.ts).
    const open = { label: t('Open in new tab'), run: () => openInTab({ kind: 'label', tag }) }
    if (root !== null && !canWriteAt(root)) {
      menu.show(event, [open])
      return
    }
    menu.show(event, [
      open,
      {
        label: t('Rename'),
        asks: true,
        run: () =>
          void prompt
            .ask({ title: t('Rename'), value: tag, confirmLabel: t('Rename') })
            .then((words) => {
              const next = words?.trim().replace(/^#+/, '')
              if (next && next !== tag && !refusedAsTag(next)) void workspace.retagNotes(tag, next)
            }),
      },
      DIVIDER,
      {
        label: t('Delete'),
        danger: true,
        asks: true,
        run: () =>
          void prompt
            .confirm({
              title: t('Delete {name}?', { name: `#${tag}` }),
              confirmLabel: t('Delete'),
              danger: true,
            })
            .then((sure) => (sure ? void workspace.retagNotes(tag, null) : undefined)),
      },
    ])
  }

  /** The chosen row's list, drawn under the rows: Todos of the open space, as it follows
   *  the space; a view's changes are kept on this device as a tab's would be. */
  const shown = $derived.by(() => {
    const row = chosen
    const name = workspace.activeSpace?.name
    return untrack(() => {
      const here: PanelRow =
        row.kind === 'todos' && row.space === undefined && name !== undefined
          ? { kind: 'todos', space: name }
          : row
      const spec = specOf(here)
      const file = here.kind === 'base' ? here.path : null
      const live = new LiveView(file === null ? panelSource(spec ?? {}) : fileSource(file))
      return { live, kit: kitFor(live, spec ?? {}, file, true) }
    })
  })
  $effect(() => {
    const here = shown
    return untrack(() => here.live.start())
  })
</script>

{#snippet row(mark: string, label: string, count: number | null, target: PanelRow, late = false)}
  <button
    type="button"
    class="nib-row"
    class:is-on={sameRow(chosen, target)}
    aria-pressed={sameRow(chosen, target)}
    onclick={(event) => press(event, target)}
    onauxclick={(event) => auxPress(event, target)}
    oncontextmenu={(event) => rowMenu(event, target)}
  >
    <span class="nib-row-mark"
      ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={mark} /></svg></span
    >
    <span class="nib-row-label">{label}</span>
    {#if count}<span class="nib-row-meta" class:late>{count}</span>{/if}
  </button>
{/snippet}

<div class="tasks" data-side={side}>
  {#if typing}
    <div class="nib-row adding">
      <span class="nib-row-mark"
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg></span
      >
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="field"
        bind:value={words}
        autofocus
        aria-label={t('Add task')}
        placeholder={t('Add task')}
        onkeydown={(event) => {
          if (event.isComposing) return
          if (event.key === 'Enter') {
            event.preventDefault()
            void write()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            typing = false
            words = ''
          }
        }}
        onblur={() => {
          if (!words.trim()) typing = false
        }}
      />
    </div>
  {:else if writes}
    <button type="button" class="nib-row adder" onclick={add}>
      <span class="nib-row-mark"
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg></span
      >
      <span class="nib-row-label">{t('Add task')}</span>
    </button>
  {/if}

  {@render row(TODAY_MARK, builtinName('todos'), counts.todos, { kind: 'todos' }, counts.overdue)}

  {#if favourites.length}
    <p class="nib-section">{t('Favorites')}</p>
    {#each favourites as one (one.path)}
      {#if one.base}
        {@render row(VIEW_MARK, one.name, one.count, { kind: 'base', path: one.path })}
      {:else if space}
        {@render row(PROJECT_MARK, one.name, one.count, {
          kind: 'project',
          space: space.name,
          path: one.relative,
        })}
      {/if}
    {/each}
  {/if}

  {#if counts.labels.length}
    <p class="nib-section">{t('Labels')}</p>
    {#each counts.labels as one (one.tag)}
      {@render row(LABEL_MARK, one.tag, one.count, { kind: 'label', tag: one.tag })}
    {/each}
  {/if}

  <!-- The chosen row's list, here in the panel and in no tab (#374). -->
  <div class="chosen">
    {#key shown}<ListLayout kit={shown.kit} />{/key}
  </div>
</div>

<style>
  .tasks {
    display: flex;
    flex-direction: column;
  }

  .chosen {
    margin-top: var(--space-2);
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
  }

  .nib-row-mark svg {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .late {
    color: var(--danger);
  }

  .adder {
    color: var(--muted);
  }

  .adding {
    padding-inline-start: var(--row-pad);
  }

  .field {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
  }

  .field::placeholder {
    color: var(--muted);
  }
</style>
