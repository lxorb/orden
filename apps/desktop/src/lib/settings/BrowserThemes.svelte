<script lang="ts">
  /** A theme Chrome or Firefox wears, kept as one of Orden's.
   *
   *  A row of Appearance with a button per browser, and the window a press opens:
   *  every theme that browser has installed, each on the card the theme picker draws,
   *  already in Orden's own tokens (themes/browser.ts). A card pressed is named and
   *  kept as a file in the themes folder, where any other theme is. Both lists are
   *  read as the row appears, so a browser with nothing to bring is a button that
   *  says so by being out of reach. */
  import tokens from '@nib/themes/tokens.css?raw'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import { prompt } from '../prompt.svelte'
  import { invoke } from '../tauri'
  import { type Scheme, theme } from '../theme.svelte'
  import { type Look, lookOf } from '../theme-picker/looks'
  import Mini from '../theme-picker/Mini.svelte'
  import { type BrowserTheme, ordenCss } from '../themes/browser'
  import { stamped } from '../themes/stamp'
  import { trap } from '../trap'

  const BROWSERS = ['Chrome', 'Firefox'] as const
  const SIDES: Scheme[] = ['light', 'dark']

  interface Found {
    name: string
    css: string
    looks: Look[]
  }

  const found = $state<Record<string, Found[]>>({ Chrome: [], Firefox: [] })
  /** The browser whose themes are up, or null. */
  let shown = $state<string | null>(null)

  for (const browser of BROWSERS) {
    void invoke<BrowserTheme[]>('browser_themes', { browser: browser.toLowerCase() }).then(
      (themes) => {
        found[browser] = themes
          .map((one) => ({ name: one.name, css: ordenCss(one) }))
          .filter((one) => one.css)
          .map((one) => ({
            ...one,
            looks: SIDES.filter((side) => one.css.includes(`data-theme='${side}'`)).map((side) =>
              lookOf([tokens, one.css], side),
            ),
          }))
      },
    )
  }

  $effect(() => (shown ? overlays.show(() => (shown = null)) : undefined))

  /** Named, then written under the name as an id no installed theme has yet. */
  async function keep(one: Found, browser: string) {
    const name = (
      await prompt.ask({ title: t('Name this'), value: one.name, confirmLabel: t('Save') })
    )?.trim()
    if (!name) return

    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 36) || 'theme'
    let id = slug
    for (let n = 2; theme.all.some((held) => held.id === `file:${id}`); n++) id = `${slug}-${n}`

    await invoke('write_theme', {
      id,
      css: stamped({ id, name, author: browser, version: '1' }, one.css),
    })
    await theme.reload()
    shown = null
  }
</script>

<div class="nib-setting">
  <span class="name">{t('Import')}</span>
  {#each BROWSERS as browser (browser)}
    <button class="nib-chip" disabled={!found[browser]?.length} onclick={() => (shown = browser)}
      >{browser}</button
    >
  {/each}
</div>

{#if shown}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div
    class="nib-scrim scrim"
    transition:fade={{ duration: LAYER.fade }}
    onclick={() => (shown = null)}
  ></div>

  <div
    class="nib-screen is-centred themes"
    use:trap
    role="dialog"
    aria-modal="true"
    aria-label={t('Themes')}
    transition:scale={{ duration: LAYER.rise, start: LAYER.start, easing: cubicOut }}
  >
    {#each found[shown] ?? [] as one (one)}
      <button type="button" class="card" onclick={() => keep(one, shown ?? '')}>
        <Mini looks={one.looks} />
        <span class="name">{one.name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  /* Over Settings and under the question that names a theme; see the theme store. */
  .scrim {
    --scrim-z: var(--z-store);
  }

  /* The theme picker's grid and its cards, three across, on `.nib-screen`. */
  .themes {
    z-index: var(--z-store);
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    padding: var(--space-2);
    overflow-y: auto;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    padding: 5px;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .card:hover {
    background: var(--surface-hover);
    color: var(--text-strong);
  }

  .card:active {
    background: var(--surface-press);
  }

  .card .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
