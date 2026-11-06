<script lang="ts">
  import { untrack } from 'svelte'
  import FolderOpen from 'lucide/dist/esm/icons/folder-open.mjs'
  import Globe from 'lucide/dist/esm/icons/globe.mjs'
  import { t } from './i18n.svelte'
  import Icon from './Icon.svelte'
  import { brandIcon, type IconNode, readIcon } from './icons'
  import type { BrowserId } from './import/browsers'
  import { migrating } from './migrating.svelte'
  import { takingOver } from './web/taking-over.svelte'
  import { isDesktop, isMobile } from './tauri'

  const folders = !isMobile

  const zen = isDesktop

  const OBSIDIAN = 'Obsidian'
  const NOTION = 'Notion'
  const ZEN = 'Zen'

  const BROWSER_LOGOS: Record<BrowserId, string | null> = {
    safari: 'safari',
    firefox: 'firefox',
    chrome: 'googlechrome',
    edge: 'microsoftedge',
    brave: 'brave',
    chromium: null,
    vivaldi: 'vivaldi',
    opera: 'opera',
    'opera-gx': 'operagx',
    arc: 'arc',
  }

  const listed = $derived(migrating.browserProfiles?.[0]?.browser ?? null)

  $effect(() => untrack(() => void migrating.findBrowsers()))
</script>

{#if migrating.vaults}
  {#each migrating.vaults as vault (vault.path)}
    <div class="nib-setting">
      {@render mark('obsidian', FolderOpen)}
      <span class="name" title={vault.path}>{vault.name}</span>
      <button
        class="nib-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.vault(vault)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    {@render mark(null, FolderOpen)}
    <span class="name">{t('Import a folder')}</span>
    <span class="pair">
      <button
        class="nib-chip is-quiet"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => migrating.back()}
      >
        {t('Back')}
      </button>
      <button
        class="nib-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.folder()}
      >
        {t('Import')}
      </button>
    </span>
  </div>
{:else if migrating.profiles}
  {#each migrating.profiles as profile (profile.path)}
    <div class="nib-setting">
      {@render mark('zenbrowser', Globe)}
      <span class="name" title={profile.path}>{profile.name}</span>
      <button
        class="nib-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.zenProfile(profile)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    <span class="name"></span>
    <button
      class="nib-chip is-quiet"
      type="button"
      disabled={migrating.working}
      aria-busy={migrating.working}
      onclick={() => migrating.back()}
    >
      {t('Back')}
    </button>
  </div>
{:else if migrating.browserProfiles}
  {#each migrating.browserProfiles as profile (profile.path)}
    <div class="nib-setting">
      {@render mark(listed ? BROWSER_LOGOS[listed] : null, Globe)}
      <span class="name" title={profile.path}>{profile.name}</span>
      <button
        class="nib-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.browserProfile(profile)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    <span class="name"></span>
    <button
      class="nib-chip is-quiet"
      type="button"
      disabled={migrating.working}
      aria-busy={migrating.working}
      onclick={() => migrating.back()}
    >
      {t('Back')}
    </button>
  </div>
{:else}
  {#if takingOver.offered}
    <div class="nib-setting">
      {@render mark(null, Globe)}
      <span class="name">{t('Notes from nibeditor.com')}</span>
      {#if takingOver.state === 'nothing'}
        <span class="value">{t('Nothing there')}</span>
      {:else}
        <button
          class="nib-chip"
          type="button"
          disabled={takingOver.state === 'asking' || migrating.working}
          aria-busy={takingOver.state === 'asking' || migrating.working}
          onclick={() => takingOver.bring()}
        >
          {t('Import')}
        </button>
      {/if}
    </div>
  {/if}

  {#if folders}
    <div class="nib-setting">
      {@render mark('obsidian', FolderOpen)}
      <span class="name">{OBSIDIAN}</span>
      <button
        class="nib-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.obsidian()}
      >
        {t('Import')}
      </button>
    </div>
  {/if}

  <div class="nib-setting">
    {@render mark('notion', FolderOpen)}
    <span class="name">{NOTION}</span>
    <button
      class="nib-chip"
      type="button"
      disabled={migrating.working}
      aria-busy={migrating.working}
      onclick={() => void migrating.files()}
    >
      {t('Import')}
    </button>
  </div>

  {#if zen}
    <div class="nib-setting">
      {@render mark('zenbrowser', Globe)}
      <span class="name">{ZEN}</span>
      <button
        class="nib-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.zen()}
      >
        {t('Import')}
      </button>
    </div>
  {/if}

  {#each migrating.browsers as found (found.browser)}
    <div class="nib-setting">
      {@render mark(BROWSER_LOGOS[found.browser], Globe)}
      <span class="name">{found.name}</span>
      <button
        class="nib-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.browser(found)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    {@render mark(null, FolderOpen)}
    <span class="name">{t('Another app')}</span>
    <span class="pair">
      <button
        class="nib-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.files()}
      >
        {t('Import')}
      </button>
      {#if folders}
        <button
          class="nib-chip"
          type="button"
          disabled={migrating.working}
          aria-busy={migrating.working}
          onclick={() => void migrating.folder()}
        >
          {t('Import a folder')}
        </button>
      {/if}
    </span>
  </div>
{/if}

{#snippet mark(slug: string | null, fallback: IconNode)}
  <span class="nib-setting-mark" aria-hidden="true"
    ><Icon icon={slug === null ? null : readIcon(brandIcon(slug))} {fallback} /></span
  >
{/snippet}

<style>
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-row);
    font-weight: var(--weight-row);
    color: var(--text);
  }

  :global([data-touch]) .name {
    font-size: var(--touch-text);
  }

  .value {
    flex: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .pair {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
