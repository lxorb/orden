<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { roving } from './roving'
  import { DIVIDER, menu, type MenuEntry } from './menu.svelte'
  import { longPress } from './longpress'
  import { search } from './search.svelte'
  import { canWriteAt } from './sharing.svelte'
  import { renameTag, removeTag } from './tag-actions'
  import type { TagNode } from './tag-tree'
  import { workspace } from './workspace.svelte'
  import TagTree from './TagTree.svelte'
  import Twist from './Twist.svelte'
  import { dur, slide } from './motion'

  const { nodes, depth = 0 }: { nodes: TagNode[]; depth?: number } = $props()

  function menuFor(node: TagNode): MenuEntry[] {
    const label = workspace.undoLabel
    const writes = canWriteAt(workspace.activeSpace?.root ?? '')

    return [
      ...(writes
        ? [
            { label: t('Rename tag'), run: () => void renameTag(node) },
            { label: t('Delete tag'), danger: true, run: () => void removeTag(node) },
          ]
        : []),
      ...(label ? [DIVIDER, { label, run: () => void workspace.undoFileAction() }] : []),
    ]
  }
</script>

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
          class="orden-row row"
          class:nested={!node.children.length}
          data-tag={node.path}
          style:--level={depth}
          onclick={() => search.ask(`tag:${node.path}`)}
          oncontextmenu={(event) => menu.show(event, menuFor(node), { title: node.name })}
          use:longPress={(event) => menu.show(event, menuFor(node), { title: node.name })}
        >
          <span class="orden-row-label"><bdi>{node.name}</bdi></span>
          <span class="orden-row-meta">{node.notes}</span>
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

  .line {
    display: flex;
    align-items: center;
  }

  .twist {
    position: relative;
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

  .twist::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline: calc(-1 * var(--space-1));
  }

  :global([data-touch]) .twist::before {
    inset-inline-end: min(
      calc(-1 * var(--space-1)),
      calc(var(--icon-md) + 2 * var(--space-1) - var(--touch-target))
    );
  }

  .chevron {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
  }

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
