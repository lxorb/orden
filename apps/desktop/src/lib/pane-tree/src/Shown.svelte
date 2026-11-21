<script lang="ts">
  import type { Snippet } from 'svelte'
  import { giveTabShown } from '../../panes/src/api'

  const { shown, children }: { shown: boolean; children: Snippet } = $props()
  giveTabShown(() => shown)
</script>

{@render children()}
