<script lang="ts">
  import tokens from '@orden/themes/tokens.css?raw'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from '../i18n.svelte'
  import { LAYER } from '../motion'
  import { overlays } from '../overlays'
  import { prompt } from '../prompt.svelte'
  import { invoke } from '../tauri'
  import type { Scheme } from '../theme.svelte'
  import { type Look, lookOf } from '../theme-picker/looks'
  import Mini from '../theme-picker/Mini.svelte'
  import { type BrowserTheme, ordenTheme } from '../themes/browser'
  import { keepTheme } from '../themes/kept'
  import { trap } from '../trap'

  const BROWSERS = ['Chrome', 'Firefox'] as const
  const SIDES: Scheme[] = ['light', 'dark']

  interface Found {
    name: string
    css: string
    looks: Look[]
  }

  const found = $state<Record<string, Found[]>>({ Chrome: [], Firefox: [] })
  let shown = $state<string | null>(null)

  for (const browser of BROWSERS) {
    void invoke<BrowserTheme[]>('browser_themes', { browser: browser.toLowerCase() }).then(
      (themes) => {
        found[browser] = themes
          .map((one) => ({ name: one.name, css: ordenTheme(one) }))
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

  async function keep(one: Found, browser: string) {
    const name = (
      await prompt.ask({ title: t('Name this'), value: one.name, confirmLabel: t('Save') })
    )?.trim()
    if (!name) return

    await keepTheme(name, one.css, browser)
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
        <Mini looks={one.looks} desk={one.css.includes('[data-translucent]')} />
        <span class="name">{one.name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .scrim {
    --scrim-z: var(--z-store);
  }

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
