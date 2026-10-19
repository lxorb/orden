<script lang="ts">
  /** The one scheduler on the page, put there the first time somebody schedules
   *  (scheduling.svelte.ts). Made again for every opening, so nothing typed or turned
   *  in one is left over in the next. */
  import { scheduling } from './scheduling.svelte'
  import SchedulePicker from './SchedulePicker.svelte'

  const asked = $derived(scheduling.shown)
</script>

{#if asked}
  {#key asked}
    <SchedulePicker {asked} onclose={() => scheduling.close()} />
  {/key}
{/if}
