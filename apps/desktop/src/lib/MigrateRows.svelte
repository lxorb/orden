<script lang="ts">
  /** The rows that bring notes over from another app, each into a space of its own:
   *  Settings' Import pane.
   *
   *  The iPhone's "Transfer Your Apps & Data": a row per place the notes could come
   *  from and nothing to read. Obsidian and Notion by name, because they are where
   *  most people arrive from; everything else is one row, since the import tells an
   *  `.enex` from a Logseq graph by itself (docs/import.md, "Nobody picks a format").
   *  Names and no logos, the way every row in Settings is a title and a button.
   *
   *  Obsidian on a desktop opens on the vaults Obsidian lists, the way Arc opens on
   *  the browsers it found; see migrating.svelte.ts. Zen, the browser, the same way
   *  with its profiles, where it keeps more than one. And a row for every other
   *  browser this desktop has a profile of - Firefox, Chrome, Edge, Brave, Chromium,
   *  Vivaldi - asked as the rows are drawn, so a browser that is not there has no row. */
  import { untrack } from 'svelte'
  import { t } from './i18n.svelte'
  import { migrating } from './migrating.svelte'
  import { takingOver } from './web/taking-over.svelte'
  import { isDesktop, isMobile } from './tauri'

  /** A phone hands over files one at a time and never a folder; see
   *  import/picking.ts. So there, a vault or a graph arrives as a zip, through
   *  the row that takes files. */
  const folders = !isMobile

  /** Zen's profiles are on this machine's disk, which only the desktop reads. */
  const zen = isDesktop

  /** An app's name is its name in every language, as in the import sheet. */
  const OBSIDIAN = 'Obsidian'
  const NOTION = 'Notion'
  const ZEN = 'Zen'

  $effect(() => untrack(() => void migrating.findBrowsers()))
</script>

{#if migrating.vaults}
  {#each migrating.vaults as vault (vault.path)}
    <div class="nib-setting">
      <span class="name" title={vault.path}>{vault.name}</span>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.vault(vault)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    <span class="name">{t('Import a folder')}</span>
    <span class="pair">
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => migrating.back()}
      >
        {t('Back')}
      </button>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.folder()}
      >
        {t('Import')}
      </button>
    </span>
  </div>
{:else if migrating.profiles}
  {#each migrating.profiles as profile (profile.path)}
    <div class="nib-setting">
      <span class="name" title={profile.path}>{profile.name}</span>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.zenProfile(profile)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    <span class="name"></span>
    <button
      class="nib-button is-quiet is-soft"
      type="button"
      disabled={migrating.working}
      onclick={() => migrating.back()}
    >
      {t('Back')}
    </button>
  </div>
{:else if migrating.browserProfiles}
  {#each migrating.browserProfiles as profile (profile.path)}
    <div class="nib-setting">
      <span class="name" title={profile.path}>{profile.name}</span>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.browserProfile(profile)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    <span class="name"></span>
    <button
      class="nib-button is-quiet is-soft"
      type="button"
      disabled={migrating.working}
      onclick={() => migrating.back()}
    >
      {t('Back')}
    </button>
  </div>
{:else}
  <!-- At the browser build's new address the old address comes first of all, because
       that is where somebody who wrote in a browser left their notes; see
       web/taking-over.svelte.ts. -->
  {#if takingOver.offered}
    <div class="nib-setting">
      <span class="name">{t('Notes from nibeditor.com')}</span>
      {#if takingOver.state === 'nothing'}
        <span class="value">{t('Nothing there')}</span>
      {:else}
        <button
          class="nib-button is-quiet is-soft"
          type="button"
          disabled={takingOver.state === 'asking' || migrating.working}
          onclick={() => takingOver.bring()}
        >
          {t('Import')}
        </button>
      {/if}
    </div>
  {/if}

  {#if folders}
    <div class="nib-setting">
      <span class="name">{OBSIDIAN}</span>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.obsidian()}
      >
        {t('Import')}
      </button>
    </div>
  {/if}

  <div class="nib-setting">
    <span class="name">{NOTION}</span>
    <button
      class="nib-button is-quiet is-soft"
      type="button"
      disabled={migrating.working}
      onclick={() => void migrating.files()}
    >
      {t('Import')}
    </button>
  </div>

  {#if zen}
    <div class="nib-setting">
      <span class="name">{ZEN}</span>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.zen()}
      >
        {t('Import')}
      </button>
    </div>
  {/if}

  {#each migrating.browsers as found (found.browser)}
    <div class="nib-setting">
      <span class="name">{found.name}</span>
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.browser(found)}
      >
        {t('Import')}
      </button>
    </div>
  {/each}

  <div class="nib-setting">
    <span class="name">{t('Another app')}</span>
    <span class="pair">
      <button
        class="nib-button is-quiet is-soft"
        type="button"
        disabled={migrating.working}
        onclick={() => void migrating.files()}
      >
        {t('Import')}
      </button>
      {#if folders}
        <button
          class="nib-button is-quiet is-soft"
          type="button"
          disabled={migrating.working}
          onclick={() => void migrating.folder()}
        >
          {t('Import a folder')}
        </button>
      {/if}
    </span>
  </div>
{/if}

<style>
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-row);
    font-weight: var(--weight-row);
    color: var(--text);
  }

  /* What the old address answered, where its button was: the row's value. */
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

  .nib-button {
    flex: none;
  }

  :global([data-touch]) .name {
    font-size: var(--touch-text);
  }
</style>
