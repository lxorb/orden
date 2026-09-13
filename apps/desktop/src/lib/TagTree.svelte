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
  import { roving } from './roving'
  import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { longPress } from './longpress'
  import { search } from './search.svelte'
  import { renameTag, removeTag } from './tag-actions'
  import type { TagNode } from './tag-tree'
  import { workspace } from './workspace.svelte'
  import TagTree from './TagTree.svelte'
  import Twist from './Twist.svelte'
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

<!-- One tab stop, the arrows inside it, and left and right on a tag that holds
     tags - the same walk the file tree takes, because a tag path is the same kind of
     thing a folder path is. See roving.ts. -->
<ul
  use:roving={{
    inner: depth > 0,
    rows: '.row',
    sideways: (key, row) => {
      const path = row.dataset.tag
      if (path === undefined || (key !== 'ArrowRight' && key !== 'ArrowLeft')) return false
      const open = workspace.isTagOpen(path)
      if (key === 'ArrowRight' ? open : !open) return false
      workspace.toggleTag(path)
      return true
    },
    open: (row) => row.click(),
    peek: (row) => {
      row.click()
      row.focus()
    },
    menu: (row, at) => row.dispatchEvent(at),
  }}
>
  {#each nodes as node (node.path)}
    <!-- Whether this tag is showing what is under it, once: the row asked three
         times, and the tree is every tag in the space with no window over it. -->
    {@const open = workspace.isTagOpen(node.path)}
    <li>
      <div class="line">
        {#if node.children.length}
          <button
            class="twist"
            aria-expanded={open}
            aria-label={node.name}
            onclick={() => workspace.toggleTag(node.path)}
          >
            <span class="chevron"><Twist {open} /></span>
          </button>
        {/if}

        <button
          class="nib-row row"
          class:nested={!node.children.length}
          data-tag={node.path}
          style:--level={depth}
          onclick={() => search.ask(`tag:${node.path}`)}
          oncontextmenu={(event) => menu.show(event, menuFor(node), { title: node.name })}
          use:longPress={(event) => menu.show(event, menuFor(node), { title: node.name })}
        >
          <span class="nib-row-label">{node.name}</span>
          <span class="nib-row-meta">{node.notes}</span>
        </button>
      </div>

      {#if node.children.length && open}
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

  /* The box the twist fills; the shape and the turn are Twist.svelte's, which the
     file tree draws too. */
  .chevron {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }

  /* One step per level of the tag path, and a lead in front of the label: the
     width of the twist for a tag that has one, and the same width held empty for
     a tag that does not, so every name starts at the same place. */
  .row {
    --lead: 2px;
    flex: 1;
    min-width: 0;
    padding-inline-start: calc(var(--level, 0) * var(--row-indent) + var(--lead));
  }

  .row.nested {
    --lead: calc(var(--icon-md) + var(--space-1));
  }
</style>
