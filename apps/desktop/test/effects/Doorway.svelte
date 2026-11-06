<script lang="ts">
  import Door from '../../src/lib/Door.svelte'
  import Dropping from './Dropping.svelte'

  const { fetched }: { fetched: () => void } = $props()

  let open = $state(false)

  export function show(on: boolean) {
    open = on
  }

  const load = () => {
    fetched()
    return Promise.resolve(Dropping)
  }
</script>

<Door {open} {load}>
  {#snippet children(Got)}<Got />{/snippet}
</Door>
