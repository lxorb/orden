<script lang="ts">
  import type { Group } from '@orden/bases'
  import { untrack } from 'svelte'
  import type { Kit } from './kit'

  const {
    kit,
    group = null,
    asked = 0,
    onclose,
  }: {
    kit: Kit
    group?: Group | null
    asked?: number
    onclose?: () => void
  } = $props()

  const property = $derived(kit.live.view?.groupBy?.property)

  function start() {
    kit.add(group && property ? { property, key: group.key } : undefined)
    onclose?.()
  }

  $effect(() => {
    if (asked > 0) untrack(start)
  })
</script>
