<script lang="ts">
  import { cubicOut } from 'svelte/easing'
  import { fly } from 'svelte/transition'
  import { plural, t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import type { Thread } from '../chat/types'
  import Changes from './Changes.svelte'
  import { review } from './review.svelte'
  import Tally from './Tally.svelte'

  const { thread }: { thread: Thread } = $props()

  const notes = $derived(review.notes(thread))
  const all = $derived(notes.flatMap((note) => note.changes))
  const files = $derived(review.files(thread))
  const waiting = $derived(all.length + files.length)
  const added = $derived(notes.reduce((sum, note) => sum + note.added, 0))
  const removed = $derived(notes.reduce((sum, note) => sum + note.removed, 0))
  const listing = $derived(review.listing === thread.id && waiting > 0)

  function toggle() {
    review.listing = listing ? null : thread.id
  }
</script>

{#if waiting}
  <div class="card" transition:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
    <div class="bar">
      <button class="orden-row is-short what" aria-expanded={listing} onclick={toggle}>
        <span class="orden-row-label"
          >{review.said ??
            plural(notes.length + files.length, {
              one: '{count} note',
              other: '{count} notes',
            })}</span
        >
        <Tally {added} {removed} />
      </button>
      <button class="orden-chip is-quiet" onclick={() => void review.undoAll(thread, files)}
        >{t('Undo')}</button
      >
      <button class="orden-chip" onclick={() => review.keepAll(thread, files)}>{t('Keep')}</button>
    </div>
    <Changes {notes} {files} {thread} open={listing} />
  </div>
{/if}

<style>
  .card {
    flex: none;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    background: var(--ink-wash);
  }

  .what {
    flex: 1;
    width: auto;
    min-width: 0;
  }
</style>
