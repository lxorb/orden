<script lang="ts">
  import ChipPick from './ChipPick.svelte'
  import type { Shown } from './shown.svelte'

  const { shown }: { shown: Shown } = $props()
</script>

<div class="filters">
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
  <ChipPick
    label="Label"
    search="Search labels"
    data-todos-label
    value={shown.filter.label ?? ''}
    on={shown.filter.label !== null}
    first={{ value: '', label: 'All labels' }}
    options={shown.labels.map((one) => ({ value: one, label: one }))}
    onchange={(next: string) => shown.setLabel(next === '' ? null : next)}
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
