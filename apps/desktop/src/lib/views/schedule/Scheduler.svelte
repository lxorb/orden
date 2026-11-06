<script lang="ts">
  import { scheduling } from './scheduling.svelte'
  import SchedulePicker from './SchedulePicker.svelte'

  const asked = $derived(scheduling.shown)
</script>

{#if asked}
  {#key asked}
    <SchedulePicker {asked} onclose={() => scheduling.close()} />
  {/key}
{/if}
