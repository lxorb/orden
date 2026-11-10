<script lang="ts">
  import Icon from '../Icon.svelte'
  import { brandIcon, readIcon } from '../icons'
  import { hexOf, inkFor, type Rgb, rgbOf } from '../legibility'

  interface Props {
    name: string
    icon: string | null
    colour: string | null
    size?: number
  }

  const { name, icon, colour, size = 40 }: Props = $props()

  const LIGHT: Rgb = [255, 255, 255]
  const DARK: Rgb = [17, 20, 26]
  const ground = $derived(colour ?? '#7a8494')
  const ink = $derived(hexOf(inkFor(rgbOf(ground) ?? DARK, [LIGHT, DARK])))

  const letter = $derived(Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?')
</script>

{#if icon}
  <span
    class="logo"
    style:width="{size}px"
    style:height="{size}px"
    style:color={colour ?? 'var(--text-strong)'}
    aria-hidden="true"><Icon icon={readIcon(brandIcon(icon))} /></span
  >
{:else}
  <span
    class="mono"
    style:width="{size * 0.9}px"
    style:height="{size * 0.9}px"
    style:font-size="{size * 0.45}px"
    style:background={ground}
    style:color={ink}
    aria-hidden="true">{letter}</span
  >
{/if}

<style>
  .logo {
    display: grid;
    place-items: center;
    flex: none;
  }

  .logo :global(svg) {
    width: 100%;
    height: 100%;
  }

  .mono {
    display: grid;
    place-items: center;
    flex: none;
    border-radius: 25%;
    font-weight: 700;
    line-height: 1;
  }
</style>
