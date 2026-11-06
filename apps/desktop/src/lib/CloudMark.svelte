<script lang="ts">
  import CloudDownload from 'lucide/dist/esm/icons/cloud-download.mjs'
  import { t } from './i18n.svelte'
  import { icloud } from './icloud.svelte'
  import { isNative } from './tauri'
  import { keptAway } from './web/away.svelte'

  const { path }: { path: string } = $props()

  const said = $derived(
    isNative
      ? t('In iCloud')
      : keptAway.offline
        ? t('Not on this device. It opens once you are online again.')
        : t('Not on this device'),
  )

  $effect(() => icloud.listen())
</script>

<span
  class="cloud"
  class:coming={icloud.coming.has(path) || keptAway.fetching.has(path)}
  class:offline={!isNative && keptAway.offline}
  title={said}
  role="img"
  aria-label={said}
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#each CloudDownload as [tag, attrs], index (index)}
      <svelte:element this={tag} {...attrs} />
    {/each}
  </svg>
</span>

<style>
  .cloud {
    flex: none;
    display: grid;
    place-items: center;
    margin-inline-start: var(--space-1);
    color: var(--muted);
  }

  .cloud svg {
    display: block;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.9;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .offline {
    opacity: 0.5;
  }

  .coming {
    color: var(--accent);
    animation: waiting calc(var(--dur-slower) * 2) ease-in-out infinite alternate;
  }

  @keyframes waiting {
    to {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .coming {
      animation: none;
    }
  }
</style>
