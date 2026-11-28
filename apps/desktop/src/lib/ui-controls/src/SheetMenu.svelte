<script lang="ts">
  import { DIVIDER, menu, type MenuItem } from '../../ui-kit/src/api'
  import BottomSheet from './BottomSheet.svelte'

  function chosen(item: MenuItem) {
    if (item.more) {
      void item.more().then((rows) => menu.replace(rows))
      return
    }
    if (!item.keep) menu.hide()
    item.run()
  }
</script>

<BottomSheet open={menu.open} label={menu.title ?? 'Menu'} onclose={() => menu.hide()}>
  {#if menu.title}<h2 class="title">{menu.title}</h2>{/if}
  <div class="rows" role="menu" data-sheet-menu>
    {#each menu.items as item, at (at)}
      {#if item === DIVIDER}
        <hr />
      {:else}
        <button
          type="button"
          class="orden-row row"
          class:is-danger={item.danger}
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          disabled={item.disabled}
          onclick={() => chosen(item)}
        >
          <span class="label">{item.label}</span>
          {#if item.checked}<span class="tick" aria-hidden="true">✓</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
</BottomSheet>

<style>
  .title {
    margin: 0 0 var(--space-2);
    font-size: 1.125rem;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    min-height: var(--touch-target);
    justify-content: space-between;
    text-align: start;
  }
  .row:global(.is-danger) {
    color: var(--danger);
  }
  .label {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  hr {
    width: 100%;
    margin: var(--space-1) 0;
    border: none;
    border-top: 1px solid var(--line);
  }
</style>
