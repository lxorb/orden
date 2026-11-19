<script lang="ts">
  const { found, onimported }: { found: unknown[]; onimported?: (count: number) => void } = $props()
</script>

<button type="button" onclick={() => onimported?.(found.length)}>Import {found.length}</button>
