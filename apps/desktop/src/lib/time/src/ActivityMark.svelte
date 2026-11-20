<script lang="ts">
  import { Icon } from '../../glyphs/src/api'
  import { readIcon } from '../../ui-kit/src/api'
  import { tintOf } from './look'
  import { time } from './time.svelte'

  const { activity, size = 14 }: { activity: string | null; size?: number } = $props()
  const found = $derived(time.activity(activity))
  const icon = $derived(found?.icon ? readIcon(found.icon) : null)
</script>

<span class="mark" style:--size="{size}px" style:--tint={tintOf(activity)} aria-hidden="true">
  {#if icon}
    <span class="icon"><Icon {icon} tint={found?.tint ?? null} /></span>
  {:else}
    <span class="dot"></span>
  {/if}
</span>

<style>
  .mark {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: var(--size);
    height: var(--size);
    color: var(--tint);
  }
  .icon {
    width: 100%;
    height: 100%;
    stroke: currentColor;
    stroke-width: 2;
  }
  .dot {
    width: 62%;
    height: 62%;
    border-radius: 50%;
    background: var(--tint);
  }
</style>
