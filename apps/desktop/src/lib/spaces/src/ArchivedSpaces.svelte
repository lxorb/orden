<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { dur, slide } from '../../platform/src/api'
  import { roleOf } from '../../sharing/src/api'
  import type { Space } from '../../workspace/src/api'
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

<p class="hint">Archived spaces stay out of the space switcher until you unarchive them.</p>

{#if archived.length}
  <div class="card" data-archived-spaces>
    {#each archived as space (space.id)}
      <div class="row" transition:slide={{ duration: dur(180), easing: cubicOut }}>
        <SpaceBadge {space} />
        <span class="name">{space.name}</span>
        <button class="quiet" disabled={busy} onclick={() => void held(() => unarchiveSpace(space))}>Unarchive</button>
        <button class="quiet danger" disabled={busy} onclick={() => void held(() => deleteSpace(space))}>
          {theirs(space) ? 'Leave' : 'Delete'}
        </button>
      </div>
    {/each}
  </div>
{:else}
  <p class="hint empty">No archived spaces.</p>
{/if}

<style>
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }
  .hint.empty {
    margin-top: var(--space-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
    margin-top: var(--space-3);
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
  button.quiet {
    flex: none;
    padding: 9px 0 9px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted);
    cursor: default;
  }
  @media (hover: hover) {
    button.quiet:hover:not(:disabled) {
      color: var(--text);
    }
    button.quiet.danger:hover:not(:disabled) {
      color: var(--danger);
    }
  }
</style>
