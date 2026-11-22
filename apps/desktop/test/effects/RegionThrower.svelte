<script lang="ts">
  import { held } from './region-state.svelte'

  $effect(() => {
    if (held.fail) throw new Error('the left region broke')
  })
</script>

<p class="left">left</p>
