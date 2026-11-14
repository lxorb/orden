<script lang="ts">
  import { accentColour } from './theme/src/api'
  import { iconLibrary } from './icon-library.svelte'
  import { type IconNode, readTint, takesTint, type WrittenIcon } from './ui-kit/src/api'
  import { theme } from './theme/src/api'

  const {
    icon,
    tint = null,
    fallback = null,
  }: {
    icon: WrittenIcon | null
    tint?: string | null
    fallback?: IconNode | null
  } = $props()

  const drawing = $derived(iconLibrary.drawing(icon))
  let broken = $state<string | null>(null)
  const wanted = $derived(iconLibrary.setFor(icon))

  $effect(() => {
    if (wanted !== null) iconLibrary.load(wanted)
  })

  const stroked = $derived(drawing?.kind === 'stroked' ? drawing.icon : (fallback ?? null))

  const painted = $derived(readTint(tint))
  const colour = $derived(
    painted && drawing && drawing.kind !== 'emoji' && takesTint(icon)
      ? accentColour(painted, theme.current)
      : null,
  )
</script>

{#if drawing?.kind === 'emoji'}
  <span class="glyph emoji">{drawing.text}</span>
{:else if drawing?.kind === 'drawn'}
  <svg class="glyph drawn" viewBox={drawing.box} aria-hidden="true" style:color={colour}>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- a shipped icon set, not content -->
    {@html drawing.body}
  </svg>
{:else if drawing?.kind === 'picture' && broken !== drawing.src}
  {@const src = drawing.src}
  <img class="glyph picture" {src} alt="" draggable="false" onerror={() => (broken = src)} />
{:else if stroked}
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true" style:color={colour}>
    {#each stroked as [tag, attrs] (JSON.stringify(attrs))}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
{/if}

<style>
  .glyph {
    display: block;
    width: 100%;
    height: 100%;
    flex: none;
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .drawn {
    fill: currentColor;
    stroke: none;
  }

  .picture {
    object-fit: contain;
  }

  .emoji {
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
    font-size: 0.88em;
    line-height: 1;
  }
</style>
