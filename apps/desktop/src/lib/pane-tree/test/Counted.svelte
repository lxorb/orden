<script lang="ts">
  import type { Tab } from '../../documents/src/api'
  import { counted } from './counted'

  const { tab, shown = true }: { tab: Tab; shown?: boolean } = $props()
  counted.mounts += 1
  $effect(() => {
    counted.shown[tab.id] = shown
  })
</script>

<div class="counted">{tab.id}</div>
