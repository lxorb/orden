<script lang="ts">
  import { accentFor } from '../../../theme/src/api'
  import { initial } from '../../../ui-kit/src/api'
  import { theme } from '../../../theme/src/api'

  const { name }: { name: string } = $props()
</script>

<span
  class="orden-badge"
  style:--badge-fill={accentFor(name, theme.current)}
  style:--badge-ink="var(--accent-ink)"
  aria-hidden="true">{initial(name)}</span
>
