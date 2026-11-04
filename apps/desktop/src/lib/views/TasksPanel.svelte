<script lang="ts">
  /** The Tasks panel: the add row, then the open space's Todos - every task of the
   *  space in one view (#1046), its count in the danger tone while something is overdue
   *  - then the favourites (bookmarked notes with tasks and views) and the labels. What
   *  were Inbox, Today, Upcoming, Completed, the filters, the projects and the notes are
   *  the one view's Display menu now: its grouping, its filters and Completed tasks. A
   *  row opens its view in the tab it takes over, the way a press in the file list
   *  opens a note: the panel is navigation, the tab is the work.
   *
   *  Moved to the right, beside the note being written, it is the Todos list itself, so
   *  the day can be worked through without leaving the note. */
  import { answer, readBase, type Row } from '@orden/bases'
  import { untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { links } from '../link-index.svelte'
  import { DIVIDER, menu } from '../menu.svelte'
  import { rows } from '../rows/rows.svelte'
  import { insideSpace, samePath } from '../space-paths'
  import { invoke } from '../tauri'
  import { workspace } from '../workspace.svelte'
  import { addTyped, openQuickAdd } from './add'
  import { contextFor } from './context'
  import { todayHere } from './days'
  import { kitFor } from './kit'
  import ListLayout from './ListLayout.svelte'
  import { LiveView } from './live.svelte'
  import { ADD_MARK, LABEL_MARK, PROJECT_MARK, TODAY_MARK, VIEW_MARK } from './marks'
  import { openBaseFile, openLabel, openProject, openTodos } from './open'
  import { openByPath, panelCounts } from './panel'
  import { builtinBase } from './source'
  import { prompt } from '../prompt.svelte'
  import { canWriteAt } from '../sharing.svelte'
  import { type Builtin, readSpec } from './spec'
  import { builtinName } from './words'

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
    const base = read[path]
    const name = workspace.activeSpace?.name
    if (!base || name === undefined) return null
    try {
      const mine = all.filter((one) => one.space === name)
      return answer(base, 0, mine, contextFor({ rows: mine, today, now: `${today}T00:00:00` }))
        .total
    } catch {
      return null
    }
  }

  /** Which view the tab in front is, to mark its row. */
  const front = $derived.by(() => {
    const tab = workspace.panelTab ?? workspace.active
    if (tab?.kind !== 'view') return null
    return { path: tab.path, spec: readSpec(tab.doc) }
  })
  const isOn = (builtin: Builtin, extra?: { path?: string; tag?: string }) =>
    front?.spec?.builtin === builtin &&
    (extra?.path === undefined || front.spec.path === extra.path) &&
    (extra?.tag === undefined || front.spec.tag === extra.tag)

  /** A press opens the view in the tab the last press opened, unless that tab was kept;
   *  Ctrl or Cmd keeps the one there and opens another, as a link in a browser does. */
  const how = (event: MouseEvent) => ({ preview: !(event.ctrlKey || event.metaKey) })

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
    if (root !== null && !canWriteAt(root)) {
      menu.show(event, [{ label: t('Open'), run: () => openLabel(tag) }])
      return
    }
    menu.show(event, [
      { label: t('Open'), run: () => openLabel(tag) },
      {
        label: t('Rename'),
        asks: true,
        run: () =>
          void prompt
            .ask({ title: t('Rename'), value: tag, confirmLabel: t('Rename') })
            .then((words) => {
              const next = words?.trim().replace(/^#+/, '')
              if (next && next !== tag && !/\s/.test(next)) void workspace.retagNotes(tag, next)
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

  /** On the right: the open space's Todos, worked through beside the note. */
  const beside = $derived.by(() => {
    if (side !== 'right') return null
    const name = workspace.activeSpace?.name
    return untrack(() => {
      const spec =
        name === undefined
          ? { builtin: 'todos' as const }
          : { builtin: 'todos' as const, space: name }
      // Changes to how it is drawn here stay here: the panel keeps no words of its own.
      const live = new LiveView({
        scope: null,
        load: () => Promise.resolve(builtinBase(spec)),
        save: () => Promise.resolve(),
      })
      return { live, kit: kitFor(live, spec, null, true) }
    })
  })
  $effect(() => {
    const here = beside
    if (here) return untrack(() => here.live.start())
  })
</script>

{#snippet row(
  mark: string,
  label: string,
  count: number | null,
  on: boolean,
  open: (event: MouseEvent) => void,
  late = false,
  context?: (event: MouseEvent) => void,
)}
  <button type="button" class="nib-row" class:is-on={on} onclick={open} oncontextmenu={context}>
    <span class="nib-row-mark"
      ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={mark} /></svg></span
    >
    <span class="nib-row-label">{label}</span>
    {#if count}<span class="nib-row-meta" class:late>{count}</span>{/if}
  </button>
{/snippet}

<div class="tasks">
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

  {#if beside}
    <ListLayout kit={beside.kit} />
  {:else}
    {@render row(
      TODAY_MARK,
      builtinName('todos'),
      counts.todos,
      isOn('todos'),
      (event) => openTodos(workspace.activeSpace?.name, how(event)),
      counts.overdue,
    )}

    {#if favourites.length}
      <p class="nib-section">{t('Favorites')}</p>
      {#each favourites as one (one.path)}
        {#if one.base}
          {@render row(
            VIEW_MARK,
            one.name,
            one.count,
            front?.path !== undefined && samePath(front.path, one.path),
            (event) => openBaseFile(one.path, how(event)),
          )}
        {:else if space}
          {@const name = space.name}
          {@render row(
            PROJECT_MARK,
            one.name,
            one.count,
            isOn('project', { path: one.relative }),
            (event) => openProject(name, one.relative, undefined, how(event)),
          )}
        {/if}
      {/each}
    {/if}

    {#if counts.labels.length}
      <p class="nib-section">{t('Labels')}</p>
      {#each counts.labels as one (one.tag)}
        {@render row(
          LABEL_MARK,
          one.tag,
          one.count,
          isOn('label', { tag: one.tag }),
          (event) => openLabel(one.tag, how(event)),
          false,
          (event) => labelMenu(event, one.tag),
        )}
      {/each}
    {/if}
  {/if}
</div>

<style>
  .tasks {
    display: flex;
    flex-direction: column;
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
