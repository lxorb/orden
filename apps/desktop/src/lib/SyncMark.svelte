<script lang="ts">
  import ForeignMark from './foreign/ForeignMark.svelte'
  import HeldMark from './sync2/HeldMark.svelte'

  const { path }: { path: string | null } = $props()
</script>

<HeldMark {path} />
<ForeignMark {path} />
