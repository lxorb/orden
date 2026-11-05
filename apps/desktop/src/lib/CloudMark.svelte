<script lang="ts">
  /** Not on this Mac: a note iCloud has taken away to save space, and will bring
   *  back when it is opened. Finder's own mark for the same fact, a cloud with an
   *  arrow down, in the slot a row keeps for what it has to add about a name; see
   *  SharedMark.svelte, which is the same shape. It pulses while the note is on its
   *  way. See icloud.svelte.ts.
   *
   *  And in the browser, a note it keeps no words of: listed, and fetched from the
   *  account when it is opened (#1126; web/away.svelte.ts). Offline, it says that it
   *  cannot be opened until the account can be reached. */
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

  /* Out of reach: nothing to fetch it from until the account can be reached. */
  .offline {
    opacity: 0.5;
  }

  /* On its way. The slowest duration the app has, twice over, so it reads as
     waiting rather than as an alarm. */
  .coming {
    color: var(--accent);
    animation: waiting calc(var(--dur-slower) * 2) ease-in-out infinite alternate;
  }

  @keyframes waiting {
    to {
      opacity: 0.35;
    }
  }

  /* A still cloud, in the accent, for a reader who asked for less movement. */
  @media (prefers-reduced-motion: reduce) {
    .coming {
      animation: none;
    }
  }
</style>
