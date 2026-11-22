<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, slide } from '../../platform/src/api'
  import { roleOf } from '../../sharing/src/api'
  import { type Space, workspace } from '../../workspace/src/api'
  import { deleteSpace } from './api'
  import SpaceBadge from './SpaceBadge.svelte'
  import { archivedSpaces, unarchiveSpace } from './space-archive'

  const archived = $derived(archivedSpaces())
  let busy = $state(false)
  async function held(run: () => Promise<void>) {
    busy = true
    try {
      await run()
    } finally {
      busy = false
    }
  }
  const theirs = (space: Space) => roleOf(space.root) !== 'owner'
</script>

{#if archived.length}
  <div class="card" data-archived-spaces>
    {#each archived as space (space.id)}
      <div class="row" transition:slide={{ duration: dur(180), easing: cubicOut }}>
        <SpaceBadge {space} />
        <span class="name">{space.name}</span>
        <button
          class="orden-chip"
          disabled={busy || workspace.openedArchived === space.id}
          onclick={() => void held(() => workspace.openArchived(space.id))}>Open</button
        >
        <button class="orden-chip" disabled={busy} onclick={() => void held(() => unarchiveSpace(space))}
          >Unarchive</button
        >
        <button class="orden-chip is-danger" disabled={busy} onclick={() => void held(() => deleteSpace(space))}>
          {theirs(space) ? 'Leave' : 'Delete'}
        </button>
      </div>
    {/each}
  </div>
{:else}
  <p class="hint">No archived spaces.</p>
{/if}

<style>
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 44px;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }
  .row + .row {
    border-top: 1px solid var(--line);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
