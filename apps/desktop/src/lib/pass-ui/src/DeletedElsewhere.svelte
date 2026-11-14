<script lang="ts">
  import type { Item } from '@orden/pass/types'
  import { message } from '../../ui-kit/src/api'
  import { said } from '../../said.svelte'
  import ItemMark from './ItemMark.svelte'
  import { pass } from '../../pass-sync/src/api'

  let gone = $state.raw<Item[]>([])
  let busy = $state(false)
  let wrong = $state('')

  $effect(() => {
    const seen = pass.items
    let current = true
    void pass
      .deletedElsewhere()
      .then((found) => {
        if (current && seen === pass.items) gone = found
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  })

  async function restored(item: Item) {
    if (busy) return
    busy = true
    wrong = ''
    try {
      await pass.restoreDeleted(item)
      gone = gone.filter((one) => one.id !== item.id)
      said.say(`Restored ${item.content.title || 'Untitled'}`)
    } catch (error) {
      wrong = message(error, 'The item could not be restored.')
    } finally {
      busy = false
    }
  }
</script>

{#if gone.length}
  <section class="gone" aria-label="Deleted on another device">
    <h3 class="orden-section">Deleted on another device</h3>
    {#each gone as item (item.id)}
      <div class="one" data-gone={item.id}>
        <ItemMark content={item.content} />
        <span class="name">{item.content.title || 'Untitled'}</span>
        <button
          class="orden-button is-soft"
          type="button"
          disabled={busy}
          onclick={() => void restored(item)}>Restore</button
        >
      </div>
    {/each}
    <p class="quiet">Kept on this device for 30 days, without attachments.</p>
    {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
  </section>
{/if}

<style>
  .gone {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border-top: 1px solid var(--line);
  }

  .orden-section {
    margin: 0;
  }

  .one {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quiet {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .wrong {
    margin: 0;
    color: var(--danger);
  }
</style>
