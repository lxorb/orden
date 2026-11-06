<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'
  import Globe from 'lucide/dist/esm/icons/globe.mjs'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'
  import Icon from '../Icon.svelte'
  import { brandIcon, readIcon } from '../icons'
  import { BROWSER_LOGOS, foundBrowsers, ZEN_LOGO } from '../import/browsers'
  import { zenProfiles } from '../import/zen-profiles'
  import { migrating } from '../migrating.svelte'
  import { dur } from '../motion'
  import { settings } from '../settings.svelte'
  import { importOffer } from './import-offer.svelte'

  const { tab }: { tab: string } = $props()

  interface Offered {
    id: string
    name: string
    logo: string | null
    bring: () => Promise<boolean>
  }

  let offered = $state<Offered[]>([])

  onMount(() => {
    let gone = false
    void Promise.all([zenProfiles(), foundBrowsers()]).then(([zen, browsers]) => {
      if (gone) return
      const found: Offered[] = []
      if (zen.length)
        found.push({
          id: 'zen',
          name: 'Zen',
          logo: ZEN_LOGO,
          bring: async () => {
            await migrating.zen()
            return migrating.profiles !== null
          },
        })
      for (const one of browsers)
        found.push({
          id: one.browser,
          name: one.name,
          logo: BROWSER_LOGOS[one.browser],
          bring: async () => {
            await migrating.browser(one)
            return migrating.browserProfiles !== null
          },
        })
      if (!found.length) {
        importOffer.dropped(tab)
        return
      }
      offered = found
      importOffer.seen()
    })
    return () => {
      gone = true
    }
  })

  async function bring(one: Offered) {
    if (migrating.working) return
    importOffer.answered()
    if (await one.bring()) settings.show('import')
  }
</script>

{#if offered.length}
  <div
    class="offer"
    role="group"
    aria-label={t('Bring your bookmarks, tabs and history from another browser?')}
    data-import-offer
    transition:fade={{ duration: dur(140) }}
  >
    <p>{t('Bring your bookmarks, tabs and history from another browser?')}</p>
    <span class="browsers">
      {#each offered as one (one.id)}
        <button
          class="nib-chip"
          type="button"
          disabled={migrating.working}
          aria-busy={migrating.working}
          onclick={() => void bring(one)}
        >
          <span class="named"
            ><span class="mark" aria-hidden="true"
              ><Icon
                icon={one.logo === null ? null : readIcon(brandIcon(one.logo))}
                fallback={Globe}
              /></span
            >{one.name}</span
          >
        </button>
      {/each}
    </span>
    <button
      class="nib-glyph"
      type="button"
      aria-label={t('No thanks')}
      title={t('No thanks')}
      onclick={() => importOffer.answered()}
    >
      <Cross small />
    </button>
  </div>
{/if}

<style>
  .offer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .offer p {
    flex: 1 1 12rem;
    min-width: 0;
    margin: 0;
    color: var(--muted);
  }

  .browsers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .named {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .mark {
    display: grid;
    place-items: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    font-size: var(--icon-sm);
    stroke: currentColor;
    stroke-width: 1.75;
  }
</style>
