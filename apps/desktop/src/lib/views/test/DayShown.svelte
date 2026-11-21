<script lang="ts">
  import { giveTabShown } from '../../panes/src/api'
  import { day, dayWhileShown } from '../src/day.svelte'
  import { tabShown } from './day-shown.svelte'

  giveTabShown(() => tabShown.on)
  dayWhileShown()
</script>

<p>{day.today}</p>
