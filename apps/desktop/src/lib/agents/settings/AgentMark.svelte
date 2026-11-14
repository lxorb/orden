<script lang="ts">
  import { accentFor } from '../../accents'
  import { initial } from '../../icons'
  import { theme } from '../../theme/src/api'

  const { name }: { name: string } = $props()
</script>

<span
  class="orden-badge"
  style:--badge-fill={accentFor(name, theme.current)}
  style:--badge-ink="var(--accent-ink)"
  aria-hidden="true">{initial(name)}</span
>
