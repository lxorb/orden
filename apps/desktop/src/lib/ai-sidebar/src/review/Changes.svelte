<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, slide } from '../../../platform/src/api'
  import { insideSpace } from '../../../platform/src/api'
  import { workspace } from '../../../workspace.svelte'
  import type { Thread } from '../../../ai-providers/src/api'
  import type { Change, NoteChanges } from '../chat-parts'
  import type { FileChange } from '../chat-parts'
  import { review } from '../chat-parts'
  import Tally from './Tally.svelte'
  import { snippetOf, titleOf } from './words'

  const {
    notes,
    files,
    thread,
    open = false,
  }: { notes: NoteChanges[]; files: FileChange[]; thread: Thread; open?: boolean } = $props()

  function openMoved(file: FileChange) {
    const root = workspace.spaces.find(
      (one) => one.id === file.space || one.name === file.space || one.id === thread.space,
    )?.root
    if (root) void workspace.open(insideSpace(root, file.path))
  }

  const rows = $derived(notes.flatMap((note) => note.changes))
  let lit = $state(0)
  let list = $state<HTMLElement>()

  $effect(() => {
    if (lit >= rows.length) lit = Math.max(0, rows.length - 1)
  })

  $effect(() => {
    if (!open) return
    list?.focus({ preventScroll: true })
    const shown = setTimeout(
      () => list?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      dur(150) + 20,
    )
    return () => clearTimeout(shown)
  })

  function keys(event: KeyboardEvent) {
    const change = rows[lit]
    const key = event.key.toLowerCase()
    if (key === 'j' || key === 'arrowdown') lit = Math.min(rows.length - 1, lit + 1)
    else if (key === 'k' || key === 'arrowup') lit = Math.max(0, lit - 1)
    else if (key === 'y' && change) review.keep([change])
    else if (key === 'n' && change) void review.undo([change])
    else if (key === 'enter' && change) void review.show(change)
    else if (key === 'escape') review.listing = null
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  function litOf(change: Change): boolean {
    return rows[lit]?.id === change.id
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div class="changes" role="list" tabindex={open ? 0 : -1} bind:this={list} onkeydown={keys}>
  {#each notes as note (`${note.agent}\n${note.path}`)}
    <div class="note" role="listitem">
      <div class="line">
        <button
          class="orden-row is-short name"
          onclick={() => note.changes[0] && void review.show(note.changes[0])}
        >
          <span class="orden-row-label">{titleOf(note.path)}</span>
          <Tally added={note.added} removed={note.removed} />
        </button>
        <span class="pair">
          <button class="orden-chip is-quiet" onclick={() => void review.undo(note.changes)}
            >Undo</button
          >
          <button class="orden-chip" onclick={() => review.keep(note.changes)}>Keep</button>
        </span>
      </div>
      {#each open ? note.changes : [] as change (change.id)}
        <div class="line change" transition:slide={{ duration: dur(150), easing: cubicOut }}>
          <button
            class="orden-row is-short name"
            class:is-on={litOf(change)}
            onclick={() => {
              lit = rows.indexOf(change)
              void review.show(change)
            }}
          >
            <span class="orden-row-label" class:is-gone={!change.spots.some((one) => one.inserted)}
              >{workspace.protection.locked(note.path) ? 'Protected' : snippetOf(change)}</span
            >
            <Tally added={change.added} removed={change.removed} />
          </button>
          <span class="pair">
            <button class="orden-chip is-quiet" onclick={() => void review.undo([change])}
              >Undo</button
            >
            <button class="orden-chip" onclick={() => review.keep([change])}>Keep</button>
          </span>
        </div>
      {/each}
    </div>
  {/each}
  {#each files as file (file.id)}
    <div class="line" role="listitem">
      {#if file.kind === 'moved'}
        <button class="orden-row is-short name" onclick={() => openMoved(file)}>
          <span class="orden-row-label">{titleOf(file.from)} → {titleOf(file.path)}</span>
        </button>
      {:else}
        <span class="orden-row is-short name">
          <span class="orden-row-label is-gone">{titleOf(file.path)}</span>
        </span>
      {/if}
      <span class="pair">
        <button class="orden-chip is-quiet" onclick={() => void review.undoFiles(thread, [file])}
          >Undo</button
        >
        <button class="orden-chip" onclick={() => review.keepFiles([file])}>Keep</button>
      </span>
    </div>
  {/each}
</div>

<style>
  .changes {
    display: flex;
    flex-direction: column;
    max-height: 40vh;
    overflow: auto;
    padding: 2px;
    outline: none;
  }

  .line {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .pair {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    display: flex;
    align-items: center;
    gap: 2px;
    padding-inline-start: var(--space-2);
    background: linear-gradient(to left, var(--ground, var(--surface)) 85%, transparent);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .line:hover .pair,
  .line:focus-within .pair,
  .changes:focus-visible .is-on ~ .pair,
  :global([data-touch]) .pair {
    opacity: 1;
  }

  .change .name {
    padding-inline-start: var(--row-indent);
  }

  .name {
    flex: 1;
    width: auto;
    min-width: 0;
  }

  .is-gone {
    color: var(--danger);
    text-decoration: line-through;
  }
</style>
