<script lang="ts">
  import Server from 'lucide/dist/esm/icons/server.mjs'
  import { Icon } from '../../../glyphs/src/api'
  import type { Colour } from './hosts'

  const { colour = null }: { colour?: Colour | null } = $props()
</script>

<span
  class="mark"
  style:color={colour === null ? undefined : `var(--canvas-${colour})`}
  aria-hidden="true"
>
  <Icon icon={null} fallback={Server} />
</span>

<style>
  .mark {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    stroke: currentColor;
    stroke-width: 1.6;
  }
</style>
