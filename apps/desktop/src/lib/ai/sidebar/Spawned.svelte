<script lang="ts">
  import { t } from '../../i18n.svelte'
  import { chat } from './chat.svelte'

  const { threads }: { threads: readonly string[] } = $props()

  const MOST = 3

  let all = $state(false)

  const rows = $derived(
    threads.flatMap((id) => {
      const title = chat.threadOf(id)?.title ?? chat.every.find((one) => one.id === id)?.title
      return title === undefined ? [] : [{ id, title }]
    }),
  )
  const shown = $derived(all ? rows : rows.slice(0, MOST))
</script>

{#if rows.length}
  <ul class="spawned">
    {#each shown as one (one.id)}
      <li>
        <button class="nib-row is-short" onclick={() => void chat.openThread(one.id)}>
          <span class="nib-row-label">{one.title || t('Untitled')}</span>
          {#if chat.running.includes(one.id)}<span class="dot"></span>{:else}<span
              class="nib-row-meta">{t('Open')}</span
            >{/if}
        </button>
      </li>
    {/each}
    {#if shown.length < rows.length}
      <li>
        <button class="nib-row is-short" onclick={() => (all = true)}>
          <span class="nib-row-label">{t('Show all')}</span>
          <span class="nib-row-meta">{rows.length}</span>
        </button>
      </li>
    {/if}
  </ul>
{/if}

<style>
  .spawned {
    display: flex;
    flex-direction: column;
    margin: 2px 0 2px 13px;
    padding: 0;
    list-style: none;
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border: 1.5px solid var(--accent);
    border-radius: 50%;
  }
</style>
