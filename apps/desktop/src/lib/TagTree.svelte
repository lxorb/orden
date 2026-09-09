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
  import { dur } from './motion'

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
          class="nib-row row"
          class:nested={!node.children.length}
          style:--level={depth}
          onclick={() => search.ask(`tag:${node.path}`)}
          oncontextmenu={(event) => menu.show(event, menuFor(node), { title: node.name })}
          use:longPress={(event) => menu.show(event, menuFor(node), { title: node.name })}
        >
          <span class="nib-row-label">{node.name}</span>
          <span class="nib-row-meta">{node.total}</span>
        </button>
      </div>

      {#if node.children.length && workspace.isTagOpen(node.path)}
        <div transition:slide={{ duration: dur(190), easing: cubicOut }}>
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
     the one row the file tree draws - which is `.nib-row`, in the themes
     package; what is left here is the twist in front of it and the step per
     level of the tag path. */
  .line {
    display: flex;
    align-items: center;
  }

  .twist {
    flex: none;
    min-height: var(--row-height);
    display: flex;
    align-items: center;
    padding: 0 0 0 var(--space-1);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    cursor: default;
  }

  .twist:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .chevron {
    width: var(--icon-md);
    height: var(--icon-md);
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

  /* One step per level of the tag path, and a lead in front of the label: the
     width of the twist for a tag that has one, and the same width held empty for
     a tag that does not, so every name starts at the same place. */
  .row {
    --lead: 2px;
    flex: 1;
    min-width: 0;
    padding-left: calc(var(--level, 0) * var(--row-indent) + var(--lead));
  }

  .row.nested {
    --lead: calc(var(--icon-md) + var(--space-1));
  }
</style>
