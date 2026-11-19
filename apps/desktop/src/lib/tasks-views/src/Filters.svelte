<script lang="ts">
  import LabelSelect from './LabelSelect.svelte'
  import type { Shown } from './shown.svelte'

  const { shown }: { shown: Shown } = $props()
</script>

<div class="filters">
  <label class="only">
    <input
      type="checkbox"
      class="orden-checkbox"
      data-todos-only-space
      checked={shown.onlySpace}
      disabled={shown.space === null}
      onchange={(event) => shown.setOnlySpace(event.currentTarget.checked)}
    />
    Only this space
  </label>
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
  .only {
    display: inline-flex;
    align-items: center;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    white-space: nowrap;
  }
</style>
