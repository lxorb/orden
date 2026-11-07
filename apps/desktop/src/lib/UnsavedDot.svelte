<script lang="ts">
  import { t } from './i18n.svelte'
  import { dur, fade } from './motion'

  const { corner = false, pressable = false }: { corner?: boolean; pressable?: boolean } = $props()
</script>

<span
  class="orden-unsaved"
  class:is-corner={corner}
  class:is-pressable={pressable}
  role="img"
  aria-label={t('Unsaved')}
  title={t('Unsaved')}
  transition:fade={{ duration: dur(140) }}
></span>
