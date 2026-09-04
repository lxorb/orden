<script lang="ts">
  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { copyPathEntry, DIVIDER, menu, type MenuEntry, revealEntry } from './menu.svelte'
  import { longPress } from './longpress'
  import { folderOf } from './tauri'
  import type { Entry } from './workspace.svelte'
  import { workspace } from './workspace.svelte'
  import Tree from './Tree.svelte'

  let { entries, depth = 0 }: { entries: Entry[]; depth?: number } = $props()

  let dropTarget = $state<string | null>(null)

  const stripped = (name: string) => name.replace(/\.(md|markdown|mdown|mkd)$/i, '')

  function folderMenu(entry: Entry): MenuEntry[] {
    return [
      { label: t('New note'), run: () => workspace.createNote(entry.path) },
      { label: t('New folder'), run: () => workspace.createFolder(entry.path) },
      DIVIDER,
      { label: t('Rename'), run: () => (workspace.renaming = entry.path) },
      { label: pinLabel(entry.path), run: () => workspace.togglePin(entry.path) },
      ...revealEntry(entry.path),
      DIVIDER,
      { label: t('Delete'), danger: true, run: () => workspace.remove(entry.path, true) },
      ...undoEntry(),
    ]
  }

  const pinLabel = (path: string) => (workspace.isPinned(path) ? t('Unpin') : t('Pin to the top'))

  /** Only offered once there is something to take back. */
  function undoEntry(): MenuEntry[] {
    const label = workspace.undoLabel
    return label ? [DIVIDER, { label, run: () => workspace.undoFileAction() }] : []
  }

  function noteMenu(entry: Entry): MenuEntry[] {
    return [
      { label: t('Open'), run: () => workspace.open(entry.path) },
      DIVIDER,
      { label: t('Rename'), run: () => (workspace.renaming = entry.path) },
      { label: pinLabel(entry.path), run: () => workspace.togglePin(entry.path) },
      { label: t('Duplicate'), run: () => workspace.duplicate(entry.path) },
      ...copyPathEntry(entry.path),
      ...revealEntry(entry.path),
      DIVIDER,
      { label: t('Delete'), danger: true, run: () => workspace.remove(entry.path, false) },
      ...undoEntry(),
    ]
  }

  function commit(path: string, value: string) {
    workspace.renaming = null
    void workspace.rename(path, value)
  }

  function startDrag(event: DragEvent, path: string) {
    event.dataTransfer?.setData('text/nib-path', path)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function overFolder(event: DragEvent, path: string) {
    if (!event.dataTransfer?.types.includes('text/nib-path')) return

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    dropTarget = path
  }

  /** `dragleave` also fires when the pointer moves onto a child - the label
   *  inside a row, the icon inside a space - and the `dragover` that follows
   *  sets it straight back. That off-on-off is the flicker. Geometry settles
   *  it: still inside the box means still over the thing. */
  function stillInside(event: DragEvent): boolean {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return (
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom
    )
  }

  function drop(event: DragEvent, folder: string) {
    event.preventDefault()
    dropTarget = null

    const from = event.dataTransfer?.getData('text/nib-path')
    if (from) void workspace.move(from, folder)
  }

  /** A note is a target too, standing for the folder it sits in. Without this
   *  the only way out of a folder would be another folder to drop onto, and a
   *  space with one folder in it would be a trap. */
  function dropBeside(event: DragEvent, path: string) {
    event.preventDefault()
    dropTarget = null

    const from = event.dataTransfer?.getData('text/nib-path')
    if (from) void workspace.move(from, folderOf(path))
  }
</script>

<ul>
  {#each entries as entry (entry.path)}
    <li>
      {#if workspace.renaming === entry.path}
        <!-- The name arrives selected, the way every file manager does it:
             renaming usually replaces the name rather than adding to it. The
             value already leaves the extension off, so this selects the name
             and nothing else. -->
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="rename"
          style:padding-left="{depth * 12 + 8}px"
          value={entry.is_dir ? entry.name : stripped(entry.name)}
          autofocus
          spellcheck="false"
          onfocus={(event) => event.currentTarget.select()}
          onblur={(event) => commit(entry.path, fullName(entry, event.currentTarget.value))}
          onkeydown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              workspace.renaming = null
            }
          }}
        />
      {:else if entry.is_dir}
        <button
          class="row folder"
          class:dropping={dropTarget === entry.path}
          style:padding-left="{depth * 12 + 8}px"
          aria-expanded={workspace.isExpanded(entry.path)}
          draggable="true"
          onclick={() => workspace.toggleFolder(entry.path)}
          oncontextmenu={(event) => menu.show(event, folderMenu(entry), { title: entry.name })}
          use:longPress={(event) => menu.show(event, folderMenu(entry), { title: entry.name })}
          ondragstart={(event) => startDrag(event, entry.path)}
          ondragover={(event) => overFolder(event, entry.path)}
          ondragleave={(event) => stillInside(event) || (dropTarget = null)}
          ondrop={(event) => drop(event, entry.path)}
        >
          <svg class="chevron" class:open={workspace.isExpanded(entry.path)} viewBox="0 0 8 8">
            <path d="M2 1l3 3-3 3" />
          </svg>
          <span class="label">{entry.name}</span>
        </button>

        {#if workspace.isExpanded(entry.path)}
          <div transition:slide={{ duration: 190, easing: cubicOut }}>
            <Tree entries={entry.children} depth={depth + 1} />
          </div>
        {/if}
      {:else}
        <button
          class="row note"
          class:active={workspace.active?.path === entry.path}
          class:dropping={dropTarget === entry.path}
          style:padding-left="{depth * 12 + 20}px"
          draggable="true"
          onclick={() => workspace.open(entry.path, { preview: true })}
          ondblclick={() => workspace.open(entry.path)}
          oncontextmenu={(event) => menu.show(event, noteMenu(entry), { title: stripped(entry.name) })}
          use:longPress={(event) => menu.show(event, noteMenu(entry), { title: stripped(entry.name) })}
          ondragstart={(event) => startDrag(event, entry.path)}
          ondragover={(event) => overFolder(event, entry.path)}
          ondragleave={(event) => stillInside(event) || (dropTarget = null)}
          ondrop={(event) => dropBeside(event, entry.path)}
        >
          <span class="label">{stripped(entry.name)}</span>
        </button>
      {/if}
    </li>
  {/each}
</ul>

<script module lang="ts">
  /** Folders keep their name; notes keep their extension. */
  function fullName(entry: { is_dir: boolean; name: string }, typed: string): string {
    if (entry.is_dir) return typed
    const extension = entry.name.match(/\.[^.]+$/)?.[0] ?? '.md'
    return typed.endsWith(extension) ? typed : typed + extension
  }
</script>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: left;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .row:hover {
    background: var(--item-hover-bg-color);
    color: var(--item-hover-text-color);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .note.active {
    background: var(--active-file-bg-color);
    color: var(--active-file-text-color);
    font-weight: 550;
  }

  .folder {
    color: var(--muted);
  }

  .row.dropping {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
    color: var(--text-strong);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rename {
    width: 100%;
    padding: 4px 8px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    outline: none;
  }

  .chevron {
    width: 8px;
    height: 8px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    transition: transform var(--dur-base) var(--ease-out);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  /* A 25px row is a desktop row. A thumb needs the whole line, and the tree is
     the main thing anyone taps in the drawer. */
  @media (max-width: 720px) {
    .row {
      min-height: 48px;
      padding-top: 0;
      padding-bottom: 0;
      font-size: var(--text-base);
    }

    .rename {
      min-height: 48px;
      font-size: var(--text-base);
    }
  }
</style>
