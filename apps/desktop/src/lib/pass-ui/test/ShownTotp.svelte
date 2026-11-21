<script lang="ts">
  import { giveTabShown } from '../../panes/src/api'
  import TotpRow from '../src/TotpRow.svelte'

  const { secret }: { secret: string } = $props()
  let shown = $state(true)
  giveTabShown(() => shown)
  export function show(on: boolean) {
    shown = on
  }
</script>

<TotpRow {secret} />
