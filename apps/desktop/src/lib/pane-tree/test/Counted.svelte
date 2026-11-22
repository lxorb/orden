<script lang="ts">
  import type { Tab } from '../../documents/src/api'
  import { whileShown } from '../../panes/src/api'
  import { counted } from './counted'

  const { tab, shown = true }: { tab: Tab; shown?: boolean } = $props()
  counted.mounts += 1
  whileShown(1000, () => (counted.ticks += 1))
  function fail(): string {
    throw new Error('a surface failed as it was put behind')
  }
  $effect(() => {
    counted.shown[tab.id] = shown
  })
  $effect(() => () => {
    if (counted.leaveThrows) throw new Error('a surface failed as it was taken down')
  })
</script>

<div class="counted">{tab.id}{!shown && counted.throws ? fail() : ''}</div>
