"""The markup a group needs: a twist in front of it, and a step in for what is in
it. The shape is TagTree's, which answers the same question in the same panel."""

import pathlib

path = pathlib.Path("apps/desktop/src/lib/Bookmarks.svelte")
text = path.read_text(encoding="utf-8")

PAIRS = [
    (
        """    {#each rows as row (`${row.mark.kind}:${row.mark.path}:${row.mark.text}`)}
      <li>
        <button
          class="nib-row row"
          class:is-quiet={row.mark.kind === 'folder'}
          class:is-on={row.active}
          class:above={dropAt === row.at && dropAbove}
          class:below={dropAt === row.at && !dropAbove}
          draggable="true"
          onclick={() => open(row, true)}
          ondblclick={() => open(row, false)}
          oncontextmenu={(event) =>
            menu.show(event, bookmarkEntry(row.mark), { title: titleOf(row) })}
          use:longPress={(event) =>
            menu.show(event, bookmarkEntry(row.mark), {
              title: titleOf(row),
            })}
          ondragstart={(event) => startDrag(event, row)}
          ondragover={(event) => over(event, row)}
          ondragleave={() => (dropAt = null)}
          ondragend={endDrag}
          ondrop={(event) => drop(event, row)}
        >
          <!-- Every row wears one, so every name in the panel starts at the
               same place: the kind the file is in the tree below, or the
               magnifier for a search, which points at no file at all. -->
          {#if row.kind && row.path}
            <FileMark mark={row.kind} path={row.path} />
          {:else if row.kind}
            <FileMark mark={row.kind} />
          {:else}
            <svg class="nib-row-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
          {/if}
          <span class="nib-row-label">{row.label}</span>
          {#if row.note}<span class="nib-row-meta">{row.note}</span>{/if}
        </button>
      </li>
    {/each}""",
        """    {#each rows as row (`${row.mark.kind}:${row.mark.path}:${row.mark.text}`)}
      <li>
        <!-- A group's twist and its name are two buttons rather than one,
             because they do two things: opening a group is not renaming it. The
             shape is the tag tree's, which answers the same question one panel
             along. -->
        <div class="line">
          {#if row.mark.kind === 'group'}
            <button
              class="twist"
              style:--level={row.depth}
              aria-expanded={workspace.isGroupOpen(row.mark.path)}
              aria-label={row.label}
              onclick={() => workspace.toggleGroup(row.mark.path)}
            >
              <span class="chevron"><Twist open={workspace.isGroupOpen(row.mark.path)} /></span>
            </button>
          {/if}
          <button
            class="nib-row row"
            class:is-quiet={row.mark.kind === 'folder'}
            class:is-on={row.active}
            class:above={dropAt === row.at && dropAbove}
            class:below={dropAt === row.at && !dropAbove}
            class:nested={row.mark.kind !== 'group'}
            style:--level={row.depth}
            draggable="true"
            onclick={() => open(row, true)}
            ondblclick={() => open(row, false)}
            oncontextmenu={(event) => menu.show(event, rowMenu(row), { title: titleOf(row) })}
            use:longPress={(event) => menu.show(event, rowMenu(row), { title: titleOf(row) })}
            ondragstart={(event) => startDrag(event, row)}
            ondragover={(event) => over(event, row)}
            ondragleave={() => (dropAt = null)}
            ondragend={endDrag}
            ondrop={(event) => drop(event, row)}
          >
            <!-- Every row wears one, so every name in the panel starts at the
                 same place: the kind the file is in the tree below, the
                 magnifier for a search, which points at no file at all, and
                 nothing at all for a group, whose twist is in front of it. -->
            {#if row.kind && row.path}
              <FileMark mark={row.kind} path={row.path} />
            {:else if row.kind}
              <FileMark mark={row.kind} />
            {:else if row.mark.kind !== 'group'}
              <svg class="nib-row-mark" viewBox="0 0 13 13"><path d={SEARCH_MARK} /></svg>
            {/if}
            <span class="nib-row-label">{row.label}</span>
            {#if row.note}<span class="nib-row-meta">{row.note}</span>{/if}
          </button>
        </div>
      </li>
    {/each}""",
    ),
    (
        """  import { menu } from './menu.svelte'""",
        """  import { menu } from './menu.svelte'
  import Twist from './Twist.svelte'""",
    ),
    # The menu a row offers: what it always did, plus what a group can do.
    (
        """  /** What the menu is about, for the sheet a phone heads its menus with. */
  const titleOf = (row: Row) => (row.mark.kind === 'search' ? t('Search') : row.label)""",
        """  /** What the menu is about, for the sheet a phone heads its menus with. */
  const titleOf = (row: Row) => (row.mark.kind === 'search' ? t('Search') : row.label)

  /** What a row offers: keeping or dropping the bookmark, a new group to sort
   *  them into, and - for a group - the two things only a group can do. Removing
   *  a group keeps what was in it; see remove in bookmarks.svelte.ts. */
  function rowMenu(row: Row): MenuEntry[] {
    const group = row.mark.kind === 'group'

    return [
      ...(group
        ? [
            { label: t('Rename'), run: () => void renameGroup(row.mark) },
            { label: t('Remove group'), run: () => workspace.bookmarks.remove(row.mark) },
          ]
        : bookmarkEntry(row.mark)),
      ...(row.mark.parent ? [{ label: t('Out of the group'), run: () => outOf(row) }] : []),
      DIVIDER,
      { label: t('New group'), run: () => void newGroup() },
    ]
  }

  function outOf(row: Row) {
    workspace.bookmarks.moveInto(row.mark, null)
  }

  async function newGroup() {
    const { prompt } = await import('./prompt.svelte')
    const name = await prompt.find({ title: t('New group'), confirm: t('Make') })
    if (name) workspace.bookmarks.addGroup(name)
  }

  async function renameGroup(mark: Bookmark) {
    const { prompt } = await import('./prompt.svelte')
    const name = await prompt.find({ title: t('Rename'), value: mark.text, confirm: t('Rename') })
    if (name) workspace.bookmarks.rename(mark, name)
  }""",
    ),
    # The list keys: left and right close and open a group, Delete takes a row out.
    (
        """    use:roving={{
      current: '.is-on',""",
        """    use:roving={{
      current: '.is-on',
      rows: '.row',
      sideways: (key, element) => {
        const row = rows.find((one) => one.at === Number(element.dataset.at))
        if (!row || row.mark.kind !== 'group') return false

        const open = workspace.isGroupOpen(row.mark.path)
        if (key === 'ArrowRight' && !open) workspace.toggleGroup(row.mark.path)
        else if (key === 'ArrowLeft' && open) workspace.toggleGroup(row.mark.path)
        else return false

        return true
      },
      remove: (element) => {
        const row = rows.find((one) => one.at === Number(element.dataset.at))
        if (row) workspace.bookmarks.remove(row.mark)
      },""",
    ),
    (
        """            class:nested={row.mark.kind !== 'group'}
            style:--level={row.depth}""",
        """            class:nested={row.mark.kind !== 'group'}
            style:--level={row.depth}
            data-at={row.at}""",
    ),
    # Where the rows sit.
    (
        """  .row {
    position: relative;
  }""",
        """  /* The twist and the name, side by side. */
  .line {
    display: flex;
    align-items: center;
  }

  .twist {
    flex: none;
    min-height: var(--row-height-sm);
    display: flex;
    align-items: center;
    padding-left: calc(var(--space-1) + var(--level, 0) * var(--row-indent));
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
  }

  .chevron {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }

  /* One step in per group, and in front of the name the width of a twist: held
     empty for a row that has none, so every name in the list starts at the same
     place. The tag tree does the same thing one panel along. */
  .row {
    --lead: 2px;

    position: relative;
    flex: 1;
    min-width: 0;
    padding-left: calc(var(--level, 0) * var(--row-indent) + var(--lead));
  }

  .row.nested {
    --lead: calc(var(--icon-md) + var(--space-1));
  }""",
    ),
]

for old, new in PAIRS:
    assert old in text, old[:70]
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8", newline="\n")
print("Bookmarks.svelte ok")
