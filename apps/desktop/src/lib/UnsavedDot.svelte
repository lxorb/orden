<script lang="ts">
  import { dur, fade } from './platform/src/api'

  const { corner = false, pressable = false }: { corner?: boolean; pressable?: boolean } = $props()
</script>

<span
  class="orden-unsaved"
  class:is-corner={corner}
  class:is-pressable={pressable}
  role="img"
  aria-label="Unsaved"
  title="Unsaved"
  transition:fade={{ duration: dur(140) }}
></span>
