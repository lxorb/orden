<script lang="ts">
  import SpaceMark from './SpaceMark.svelte'
  import type { Space } from './workspace.svelte'

  const { space, on = false }: { space: Space; on?: boolean } = $props()
</script>

<span class="nib-badge" class:is-on={on} aria-hidden="true">
  <SpaceMark id={space.id} name={space.name} />
</span>
