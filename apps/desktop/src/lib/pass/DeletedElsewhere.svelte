<script lang="ts">
  import type { Item } from '@orden/pass/types'
  import { message, t } from '../i18n.svelte'
  import { said } from '../said.svelte'
  import ItemMark from './ItemMark.svelte'
  import { pass } from './store.svelte'

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
      said.say(t('Restored {title}', { title: item.content.title || t('Untitled') }))
    } catch (error) {
      wrong = message(error, 'The item could not be restored.')
    } finally {
      busy = false
    }
  }
</script>

{#if gone.length}
  <section class="gone" aria-label={t('Deleted on another device')}>
    <h3 class="nib-section">{t('Deleted on another device')}</h3>
    {#each gone as item (item.id)}
      <div class="one" data-gone={item.id}>
        <ItemMark content={item.content} />
        <span class="name">{item.content.title || t('Untitled')}</span>
        <button
          class="nib-button is-soft"
          type="button"
          disabled={busy}
          onclick={() => void restored(item)}>{t('Restore')}</button
        >
      </div>
    {/each}
    <p class="quiet">{t('Kept on this device for 30 days, without attachments.')}</p>
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

  .nib-section {
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
