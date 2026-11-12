<script lang="ts">
  import { keytipIn, keytipOut } from '../keytip'
  import type { Worn } from './numbers.svelte'

  const { numbers }: { numbers: { readonly worn: readonly Worn[] } } = $props()
</script>

{#each numbers.worn as one (one.id)}
  <span
    class="orden-keytip numeral"
    style:translate="{one.x}px {one.y}px"
    aria-hidden="true"
    in:keytipIn
    out:keytipOut>{one.label}</span
  >
{/each}

<style>
  .numeral {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-popover);
    transform: translate(-60%, -60%);
  }
</style>
