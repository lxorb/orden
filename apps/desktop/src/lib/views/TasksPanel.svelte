<script lang="ts">
  /** The Tasks panel, Todoist's sidebar the nib way: where things are, with how many, in
   *  one glance. The add row, Inbox, Today (its count in the danger tone while something
   *  is overdue), Upcoming and Completed; the saved views; the favourites (bookmarked
   *  projects, notes and views); the projects - the notes in the space's projects folder,
   *  nested and in the order the file list keeps (project-tree.ts), each with its count;
   *  the other notes that hold open tasks, so a task written anywhere is in reach; and
   *  the labels. A row opens its view in the tab it takes over, the way a press in the
   *  file list opens a note: the panel is navigation, the tab is the work.
   *
   *  Moved to the right, beside the note being written, it is Today's list itself, so
   *  the day can be worked through without leaving the note. */
  import { answer, readBase, type Row } from '@nib/bases'
  import { tick, untrack } from 'svelte'
  import FileMark from '../FileMark.svelte'
  import { chosenIcon } from '../chosen-icon'
  import { t } from '../i18n.svelte'
  import { links } from '../link-index.svelte'
  import { archiveEntry, bookmarkEntry, DIVIDER, iconEntries, menu } from '../menu.svelte'
  import { projectsFolder } from '../rows/projects'
  import { rows } from '../rows/rows.svelte'
  import { insideSpace, relativeTo, samePath } from '../space-paths'
  import { invoke } from '../tauri'
  import { entryAt } from '../tree-edits'
  import Twist from '../Twist.svelte'
  import { workspace } from '../workspace.svelte'
  import { dropRow } from './act'
  import { addTyped, openQuickAdd } from './add'
  import { contextFor } from './context'
  import { todayHere } from './days'
  import { droppable } from './drag.svelte'
  import { kitFor } from './kit'
  import ListLayout from './ListLayout.svelte'
  import { LiveView } from './live.svelte'
  import {
    ADD_MARK,
    INBOX_MARK,
    LABEL_MARK,
    LOGBOOK_MARK,
    PROJECT_MARK,
    TODAY_MARK,
    UPCOMING_MARK,
    VIEW_MARK,
  } from './marks'
  import { openBaseFile, openBuiltin, openLabel, openProject } from './open'
  import { EMPTY, toggled } from './list-items'
  import { NOTES_SHOWN, openByPath, panelCounts } from './panel'
  import { addProject, addSubproject, renameProject } from './project-actions'
  import { type ProjectNode, projectNodes, projectNotes, projectRows } from './project-tree'
  import { builtinBase } from './source'
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
  const counts = $derived(panelCounts(all, today, rows.inboxes()))

  const space = $derived(workspace.activeSpace)
  const root = $derived(space?.root ?? null)

  /** Open tasks per note of the open space, by its path in the space. */
  const openIn = $derived(openByPath(counts.notes, space?.name))

  /** The projects: the projects folder's notes, as the file list has them. */
  const nodes = $derived.by((): ProjectNode[] => {
    if (root === null) return []
    const folder = entryAt(workspace.tree, projectsFolder(root))
    if (!folder?.is_dir) return []
    return projectNodes(
      folder,
      (path) => workspace.arranged.listOf(path),
      (note) => openIn.get(relativeTo(root, note)) ?? 0,
    )
  })
  let folded = $state.raw<ReadonlySet<string>>(EMPTY)
  const shownProjects = $derived(projectRows(nodes, folded))
  const inProjects = $derived(
    new Set(root === null ? [] : projectNotes(nodes).map((note) => relativeTo(root, note))),
  )

  /** The other notes with open tasks: every space's, but not a project or an inbox. */
  const inboxes = $derived(rows.inboxes())
  const notes = $derived(
    counts.notes.filter(
      (one) =>
        !(one.space === space?.name && inProjects.has(one.path)) &&
        !inboxes.some((inbox) => inbox.space === one.space && samePath(inbox.path, one.path)),
    ),
  )
  let more = $state(false)
  const notesShown = $derived(more ? notes : notes.slice(0, NOTES_SHOWN))

  /** The open space's bookmarks that are a project, a note with tasks or a view. */
  const favourites = $derived.by(() => {
    if (root === null || !space) return []
    return workspace.bookmarks.list.flatMap((mark) => {
      if (mark.kind !== 'note') return []
      const path = insideSpace(root, mark.path)
      const isBase = /\.base$/i.test(mark.path)
      const isProject = inProjects.has(mark.path)
      const holds = openIn.has(mark.path)
      if (!isBase && !isProject && !holds) return []
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

  /** The space's `.base` files: its saved views. */
  const bases = $derived.by(() => {
    if (root === null) return []
    return workspace.files
      .filter((one) => !one.is_dir && /\.base$/i.test(one.name))
      .map((one) => ({
        path: one.path,
        name: one.name.replace(/\.base$/i, ''),
        relative: relativeTo(root, one.path),
      }))
  })

  /** Each base file read once, and again when it is written. */
  let read = $state<Record<string, ReturnType<typeof readBase> | null>>({})
  $effect(() => {
    const paths = bases.map((one) => one.path)
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
    await addTyped(said, {})
  }

  /** The row a project's name is being typed into: a new one at the top of the
   *  projects, a new one inside another, or one named again. */
  let naming = $state<{ kind: 'new' } | { kind: 'inside' | 'rename'; node: ProjectNode } | null>(
    null,
  )
  let name = $state('')

  async function named() {
    const asked = naming
    const said = name.trim()
    naming = null
    name = ''
    if (!asked || !said || root === null || !space) return
    if (asked.kind === 'rename') {
      await renameProject(asked.node, said)
      return
    }
    const made =
      asked.kind === 'new' ? await addProject(root, said) : await addSubproject(asked.node, said)
    if (made) openProject(space.name, relativeTo(root, made), undefined, { preview: true })
  }

  function startNaming(next: typeof naming, words = '') {
    naming = next
    name = words
    if (next && next.kind !== 'new' && folded.has(next.node.note)) twist(next.node.note)
    // The row's field is drawn on the next turn, and only then can it take the keys.
    void tick().then(() => panel?.querySelector<HTMLInputElement>('input.naming')?.select())
  }

  let panel = $state<HTMLElement>()

  function twist(note: string) {
    folded = toggled(folded, note)
  }

  function projectMenu(event: MouseEvent, node: ProjectNode) {
    if (root === null || !space) return
    const relative = relativeTo(root, node.note)
    const folder = node.folder
    menu.show(event, [
      { label: t('Open'), run: () => openProject(space.name, relative) },
      { label: t('Open as board'), run: () => openProject(space.name, relative, 'kanban') },
      { label: t('Open as calendar'), run: () => openProject(space.name, relative, 'calendar') },
      DIVIDER,
      { label: t('Add sub-project'), run: () => startNaming({ kind: 'inside', node }) },
      { label: t('Rename'), run: () => startNaming({ kind: 'rename', node }, node.name) },
      ...iconEntries(node.note),
      ...bookmarkEntry({ kind: 'note', path: relative, text: '' }),
      DIVIDER,
      ...archiveEntry(folder ?? node.note),
      {
        label: t('Delete'),
        danger: true,
        run: () => void workspace.remove(folder ?? node.note, folder !== null),
      },
    ])
  }

  function noteMenu(event: MouseEvent, one: { space: string; path: string }) {
    menu.show(event, [
      { label: t('Open'), run: () => openProject(one.space, one.path) },
      { label: t('Open as board'), run: () => openProject(one.space, one.path, 'kanban') },
      { label: t('Open as calendar'), run: () => openProject(one.space, one.path, 'calendar') },
    ])
  }

  /** A task let go over a project: it moves there, its lines and all. */
  function takeInto(node: ProjectNode) {
    return (carried: Row) => {
      if (!carried.task || root === null) return
      void dropRow(carried, { move: { path: relativeTo(root, node.note) } })
    }
  }

  /** On the right: Today, worked through beside the note. */
  const beside = $derived.by(() => {
    if (side !== 'right') return null
    return untrack(() => {
      // Changes to how it is drawn here stay here: the panel keeps no words of its own.
      const live = new LiveView({
        scope: null,
        load: () => Promise.resolve(builtinBase({ builtin: 'today' })),
        save: () => Promise.resolve(),
      })
      return { live, kit: kitFor(live, { builtin: 'today' }, null, true) }
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

{#snippet field(placeholder: string, depth: number)}
  <div class="nib-row adding" style:--depth={depth}>
    <span class="nib-row-mark"
      ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={PROJECT_MARK} /></svg></span
    >
    <input
      class="field naming"
      bind:value={name}
      aria-label={placeholder}
      {placeholder}
      onkeydown={(event) => {
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          void named()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          naming = null
          name = ''
        }
      }}
      onblur={() => void named()}
    />
  </div>
{/snippet}

<div class="tasks" bind:this={panel}>
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
  {:else}
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
    {@render row(INBOX_MARK, builtinName('inbox'), counts.inbox, isOn('inbox'), (event) =>
      openBuiltin('inbox', how(event)),
    )}
    {@render row(
      TODAY_MARK,
      builtinName('today'),
      counts.today,
      isOn('today'),
      (event) => openBuiltin('today', how(event)),
      counts.overdue,
    )}
    {@render row(UPCOMING_MARK, builtinName('upcoming'), null, isOn('upcoming'), (event) =>
      openBuiltin('upcoming', how(event)),
    )}
    {@render row(LOGBOOK_MARK, builtinName('logbook'), null, isOn('logbook'), (event) =>
      openBuiltin('logbook', how(event)),
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

    {#if bases.length}
      <p class="nib-section">{t('Views')}</p>
      {#each bases as one (one.path)}
        {@render row(
          VIEW_MARK,
          one.name,
          baseCount(one.path),
          front?.path !== undefined && samePath(front.path, one.path),
          (event) => openBaseFile(one.path, how(event)),
        )}
      {/each}
    {/if}

    <div class="head">
      <p class="nib-section">{t('Projects')}</p>
      <button
        type="button"
        class="nib-glyph plus"
        aria-label={t('Add project')}
        title={t('Add project')}
        onclick={() => startNaming({ kind: 'new' })}
        ><svg viewBox="0 0 13 13" aria-hidden="true"><path d={ADD_MARK} /></svg></button
      >
    </div>
    {#if naming?.kind === 'new'}
      {@render field(t('Add project'), 0)}
    {/if}
    {#each shownProjects as node (node.note)}
      {@const relative = root === null ? node.note : relativeTo(root, node.note)}
      {#if naming?.kind === 'rename' && naming.node.note === node.note}
        {@render field(t('Rename'), node.depth)}
      {:else}
        <div class="project" style:--depth={node.depth} use:droppable={takeInto(node)}>
          <button
            type="button"
            class="nib-row"
            class:is-on={isOn('project', { path: relative })}
            onclick={(event) => space && openProject(space.name, relative, undefined, how(event))}
            oncontextmenu={(event) => projectMenu(event, node)}
          >
            <span class="nib-row-mark"
              >{#if chosenIcon(node.note)}<FileMark mark="note" path={node.note} />{:else}<svg
                  viewBox="0 0 13 13"
                  aria-hidden="true"><path d={PROJECT_MARK} /></svg
                >{/if}</span
            >
            <span class="nib-row-label">{node.name}</span>
            {#if node.count}<span class="nib-row-meta">{node.count}</span>{/if}
          </button>
          {#if node.children.length}
            <button
              type="button"
              class="twist"
              tabindex="-1"
              aria-label={folded.has(node.note) ? t('Expand') : t('Collapse')}
              aria-expanded={!folded.has(node.note)}
              onclick={() => twist(node.note)}><Twist open={!folded.has(node.note)} /></button
            >
          {/if}
        </div>
      {/if}
      {#if naming?.kind === 'inside' && naming.node.note === node.note}
        {@render field(t('Add sub-project'), node.depth + 1)}
      {/if}
    {/each}

    {#if notes.length}
      <p class="nib-section">{t('Notes')}</p>
      {#each notesShown as one (`${one.space}:${one.path}`)}
        {@render row(
          PROJECT_MARK,
          one.name,
          one.count,
          isOn('project', { path: one.path }),
          (event) => openProject(one.space, one.path, undefined, how(event)),
          false,
          (event) => noteMenu(event, one),
        )}
      {/each}
      {#if notes.length > NOTES_SHOWN}
        <button type="button" class="nib-row is-short more" onclick={() => (more = !more)}>
          <span class="nib-row-label">{more ? t('Less') : t('More')}</span>
        </button>
      {/if}
    {/if}

    {#if counts.labels.length}
      <p class="nib-section">{t('Labels')}</p>
      {#each counts.labels as one (one.tag)}
        {@render row(LABEL_MARK, one.tag, one.count, isOn('label', { tag: one.tag }), (event) =>
          openLabel(one.tag, how(event)),
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

  .adder,
  .more {
    color: var(--muted);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .plus {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    color: var(--muted);
  }

  .plus svg {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }

  .project {
    position: relative;
    display: flex;
    align-items: center;
    padding-inline-start: calc(var(--depth) * var(--row-indent));
    border-radius: var(--radius-row);
  }

  .project:has(.twist) .nib-row-meta {
    margin-inline-end: var(--icon-md);
  }

  .project:global(.is-taking) {
    background: var(--surface-selected);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .project > .nib-row {
    flex: 1;
    min-width: 0;
  }

  /* Todoist's place for it: at the row's end, where the eye reads a count, and the
     row's own press left to open the project. */
  .twist {
    position: absolute;
    inset-inline-end: var(--space-1);
    display: grid;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
    padding: 3px;
    border: none;
    background: none;
    color: var(--muted);
  }

  .adding {
    padding-inline-start: calc(var(--row-pad) + var(--depth, 0) * var(--row-indent));
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
