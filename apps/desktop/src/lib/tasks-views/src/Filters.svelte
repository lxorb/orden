<script lang="ts">
  import LabelSelect from './LabelSelect.svelte'
  import type { Shown } from './shown.svelte'

  const { shown }: { shown: Shown } = $props()
</script>

<div class="filters">
  <button
    type="button"
    class="orden-chip"
    class:is-on={shown.onlySpace && shown.space !== null}
    aria-pressed={shown.onlySpace && shown.space !== null}
    disabled={shown.space === null}
    data-todos-only-space
    onclick={() => shown.setOnlySpace(!shown.onlySpace)}>Only this space</button
  >
  <button
    type="button"
    class="orden-chip"
    class:is-on={shown.showDone}
    aria-pressed={shown.showDone}
    data-todos-show-done
    onclick={() => shown.setShowDone(!shown.showDone)}>Show done</button
  >
  {#if shown.where === 'board'}
    <button
      type="button"
      class="orden-chip"
      class:is-on={shown.anyStart}
      aria-pressed={shown.anyStart}
      data-todos-any-start
      onclick={() => shown.setAnyStart(!shown.anyStart)}>Ignore start date</button
    >
  {/if}
  <LabelSelect
    labels={shown.labels}
    chosen={shown.filter.label}
    onchoose={(label: string | null) => shown.setLabel(label)}
  />
</div>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }
</style>
