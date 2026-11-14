<script lang="ts">
  import { chosenIcon, chosenTint } from '../../chosen-icon'
  import Icon from '../../Icon.svelte'
  import { readIcon } from '../../ui-kit/src/api'
  import Glyph from './Glyph.svelte'

  const { path }: { path: string | null | undefined } = $props()

  const chosen = $derived(path ? readIcon(chosenIcon(path)) : null)
  const tint = $derived(path ? chosenTint(path) : null)
</script>

{#if chosen}
  <span class="worn" aria-hidden="true"><Icon icon={chosen} {tint} /></span>
{:else}
  <Glyph name="hash" />
{/if}

<style>
  .worn {
    display: block;
    flex: none;
    width: var(--glyph-size, var(--icon-md));
    height: var(--glyph-size, var(--icon-md));
    font-size: var(--glyph-size, var(--icon-md));
    stroke: currentColor;
    stroke-width: 2;
  }
</style>
