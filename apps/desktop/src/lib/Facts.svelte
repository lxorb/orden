<script lang="ts">
  type Part = string | number | null | undefined | false

  const { parts, line = false }: { parts: readonly Part[]; line?: boolean } = $props()

  const shown = $derived(
    parts.filter(
      (one): one is string | number =>
        one !== null && one !== undefined && one !== false && one !== '',
    ),
  )
</script>

<span class="facts" class:line
  >{#each shown as part, at (at)}<span class="fact">{part}</span>{/each}</span
>

<style>
  .facts {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-2);
    min-width: 0;
    max-width: 100%;
  }

  .fact {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .line {
    flex-wrap: nowrap;
    overflow: hidden;
  }

  .line .fact {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .line .fact:not(:last-child) {
    flex-shrink: 0;
  }
</style>
