<script lang="ts">
  import ForeignMark from './foreign/ForeignMark.svelte'
  import { HeldMark } from './sync-client/src/api'

  const { path }: { path: string | null } = $props()
</script>

<HeldMark {path} />
<ForeignMark {path} />
