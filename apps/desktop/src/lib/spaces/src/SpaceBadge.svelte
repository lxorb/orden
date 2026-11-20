<script lang="ts">
  import { SpaceMark } from '../../marks/src/api'
  import { CountBadge, viewport } from '../../ui-kit/src/api'
  import type { Space } from '../../workspace/src/api'

  const { space, on = false, unread = 0 }: { space: Space; on?: boolean; unread?: number } = $props()
</script>

<span class="orden-badge" class:is-on={on} aria-hidden="true">
  <SpaceMark id={space.id} name={space.name} />
  {#if unread > 0}<span class="unread"><CountBadge count={unread} most={viewport.touch ? 99 : 9} corner /></span>{/if}
</span>

<style>
  .unread > :global(.count) {
    top: -7px;
    inset-inline-end: -6px;
    box-shadow: 0 0 0 2px var(--bg);
  }
  :global([data-touch]) .unread > :global(.count) {
    top: -3px;
  }
</style>
