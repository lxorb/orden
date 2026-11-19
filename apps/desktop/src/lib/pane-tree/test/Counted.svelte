<script lang="ts">
  import type { Tab } from '../../documents/src/api'
  import { counted } from './counted'

  const { tab }: { tab: Tab } = $props()
  counted.mounts += 1
</script>

<div class="counted">{tab.id}</div>
