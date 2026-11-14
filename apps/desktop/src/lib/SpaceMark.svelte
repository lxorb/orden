<script lang="ts">
  import Icon from './Icon.svelte'
  import { iconLibrary } from './icon-library.svelte'
  import { initial, readIcon } from './ui-kit/src/api'
  import { workspace } from './workspace.svelte'

  const {
    id,
    name,
  }: {
    id: string | null
    name: string
  } = $props()

  const chosen = $derived(id ? readIcon(workspace.iconFor(id)) : null)
  const tint = $derived(id ? workspace.tintFor(id) : null)

  const drawn = $derived(iconLibrary.drawing(chosen) !== null)
</script>

{#if chosen}
  <span class="glyph" class:away={!drawn}><Icon icon={chosen} {tint} /></span>
{/if}

{#if !drawn}
  {initial(name)}
{/if}

<style>
  .glyph {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    font-size: var(--icon-md);
    stroke: currentColor;
    stroke-width: 1.7;
  }

  .glyph.away {
    display: none;
  }
</style>
