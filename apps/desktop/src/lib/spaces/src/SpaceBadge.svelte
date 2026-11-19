<script lang="ts">
  import { SpaceMark } from '../../marks/src/api'
  import { CountBadge } from '../../ui-kit/src/api'
  import type { Space } from '../../workspace/src/api'

  const { space, on = false, unread = 0 }: { space: Space; on?: boolean; unread?: number } = $props()
</script>

<span class="orden-badge" class:is-on={on} aria-hidden="true">
  <SpaceMark id={space.id} name={space.name} />
  <CountBadge count={unread} corner />
</span>
