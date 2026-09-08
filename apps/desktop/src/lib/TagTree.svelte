<script lang="ts">
  /** A space's tags, as the tree their slashes describe.
   *
   *  The file tree's rows, its disclosure and its indentation, because a tag path
   *  is the same kind of thing a folder path is and nobody should have to learn a
   *  second way of opening one. Recursive, like Tree.svelte, and for the same
   *  reason: a tag nests as deep as somebody writes it.
   *
   *  A row searches. Clicking `work/nib` asks the space for `tag:work/nib`, which
   *  is every note under it, which is the number the row was showing. */

  import { slide } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { longPress } from './longpress'
  import { search } from './search.svelte'
  import { renameTag, removeTag } from './tag-actions'
  import type { TagNode } from './tag-tree'
  import { workspace } from './workspace.svelte'
  import TagTree from './TagTree.svelte'

  const { nodes, depth = 0 }: { nodes: TagNode[]; depth?: number } = $props()

  function menuFor(node: TagNode): MenuEntry[] {
    const label = workspace.undoLabel

    return [
      { label: t('Rename tag'), run: () => void renameTag(node) },
      { label: t('Delete tag'), danger: true, run: () => void removeTag(node) },
      ...(label ? [DIVIDER, { label, run: () => void workspace.undoFileAction() }] : []),
    ]
  }
</script>

<ul>
  {#each nodes as node (node.path)}
    <li>
      <div class="line">
        {#if node.children.length}
          <button
            class="twist"
            aria-expanded={workspace.isTagOpen(node.path)}
            aria-label={node.name}
            onclick={() => workspace.toggleTag(node.path)}
          >
            <svg class="chevron" class:open={workspace.isTagOpen(node.path)} viewBox="0 0 8 8">
              <path d="M2 1l3 3-3 3" />
            </svg>
          </button>
        {/if}

        <button
          class="row"
          class:nested={!node.children.length}
          style:--level={depth}
          onclick={() => search.ask(`tag:${node.path}`)}
          oncontextmenu={(event) => menu.show(event, menuFor(node), { title: node.name })}
          use:longPress={(event) => menu.show(event, menuFor(node), { title: node.name })}
        >
          <span class="label">{node.name}</span>
          <span class="count">{node.total}</span>
        </button>
      </div>

      {#if node.children.length && workspace.isTagOpen(node.path)}
        <div transition:slide={{ duration: 190, easing: cubicOut }}>
          <TagTree nodes={node.children} depth={depth + 1} />
        </div>
      {/if}
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  /* The disclosure and the row are two buttons rather than one, because they do
     two things: opening a node is not searching for it. Side by side they read as
     the one row the file tree draws. */
  .line {
    display: flex;
    align-items: center;
  }

  .twist {
    flex: none;
    display: flex;
    align-items: center;
    padding: 4px 0 4px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    cursor: default;
  }

  .twist:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
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

  .row {
    flex: 1;
    min-width: 0;
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
      color var(--dur-fast) var(--ease-out);
  }

  .row:hover {
    background: var(--item-hover-bg-color);
    color: var(--item-hover-text-color);
  }

  .row:active {
    background: var(--press);
    color: var(--text-strong);
  }

  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* How many notes the row's own search would find. Pushed to the far end, where
     the file tree puts nothing, so the names still read as a column. */
  .count {
    margin-left: auto;
    padding-left: var(--space-1);
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  /* One step per level of the tag path, and a lead in front of the label: the
     width of the twist for a tag that has one, and the same width held empty
     for a tag that does not, so every name starts at the same place. Both come
     off properties, so a phone can take a deeper step; see Tree.svelte. */
  .row {
    --indent: 12px;
    --lead: 2px;
    padding-left: calc(var(--level, 0) * var(--indent) + var(--lead));
  }

  .row.nested {
    --lead: 20px;
  }

  :global([data-touch]) .row,
  :global([data-touch]) .twist {
    min-height: var(--touch-row);
  }

  :global([data-touch]) .row {
    --indent: var(--touch-indent);
    --lead: var(--space-1);
    gap: var(--touch-gap);
    font-size: var(--touch-text);
  }

  :global([data-touch]) .row.nested {
    --lead: calc(var(--touch-mark) + var(--space-3));
  }

  :global([data-touch]) .twist {
    padding-left: var(--space-2);
  }

  :global([data-touch]) .chevron {
    width: var(--touch-mark);
    height: var(--touch-mark);
    stroke-width: 1.1;
  }

  :global([data-touch]) .count {
    font-size: var(--text-base);
  }
</style>
