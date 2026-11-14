<script lang="ts">
  import { untrack } from 'svelte'
  import FolderOpen from 'lucide/dist/esm/icons/folder-open.mjs'
  import Globe from 'lucide/dist/esm/icons/globe.mjs'
  import Icon from './Icon.svelte'
  import { brandIcon, type IconNode, readIcon } from './icons'
  import { BROWSER_LOGOS, ZEN_LOGO } from './import/browsers'
  import { migrating } from './migrating.svelte'
  import { takingOver } from './web/taking-over.svelte'
  import { isDesktop, isMobile } from './platform/src/api'

  const folders = !isMobile

  const zen = isDesktop

  const OBSIDIAN = 'Obsidian'
  const NOTION = 'Notion'
  const ZEN = 'Zen'

  const listed = $derived(migrating.browserProfiles?.[0]?.browser ?? null)

  $effect(() => untrack(() => void migrating.findBrowsers()))
</script>

{#if migrating.vaults}
  {#each migrating.vaults as vault (vault.path)}
    <div class="orden-setting">
      {@render mark('obsidian', FolderOpen)}
      <span class="name" title={vault.path}>{vault.name}</span>
      <button
        class="orden-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.vault(vault)}
      >
        Import
      </button>
    </div>
  {/each}

  <div class="orden-setting">
    {@render mark(null, FolderOpen)}
    <span class="name">Import a folder</span>
    <span class="pair">
      <button
        class="orden-chip is-quiet"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => migrating.back()}
      >
        Back
      </button>
      <button
        class="orden-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.folder()}
      >
        Import
      </button>
    </span>
  </div>
{:else if migrating.profiles}
  {#each migrating.profiles as profile (profile.path)}
    <div class="orden-setting">
      {@render mark(ZEN_LOGO, Globe)}
      <span class="name" title={profile.path}>{profile.name}</span>
      <button
        class="orden-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.zenProfile(profile)}
      >
        Import
      </button>
    </div>
  {/each}

  <div class="orden-setting">
    <span class="name"></span>
    <button
      class="orden-chip is-quiet"
      type="button"
      disabled={migrating.working}
      aria-busy={migrating.working}
      onclick={() => migrating.back()}
    >
      Back
    </button>
  </div>
{:else if migrating.browserProfiles}
  {#each migrating.browserProfiles as profile (profile.path)}
    <div class="orden-setting">
      {@render mark(listed ? BROWSER_LOGOS[listed] : null, Globe)}
      <span class="name" title={profile.path}>{profile.name}</span>
      <button
        class="orden-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.browserProfile(profile)}
      >
        Import
      </button>
    </div>
  {/each}

  <div class="orden-setting">
    <span class="name"></span>
    <button
      class="orden-chip is-quiet"
      type="button"
      disabled={migrating.working}
      aria-busy={migrating.working}
      onclick={() => migrating.back()}
    >
      Back
    </button>
  </div>
{:else}
  {#if takingOver.offered}
    <div class="orden-setting">
      {@render mark(null, Globe)}
      <span class="name">Notes from nibeditor.com</span>
      {#if takingOver.state === 'nothing'}
        <span class="value">Nothing there</span>
      {:else}
        <button
          class="orden-chip"
          type="button"
          disabled={takingOver.state === 'asking' || migrating.working}
          aria-busy={takingOver.state === 'asking' || migrating.working}
          onclick={() => takingOver.bring()}
        >
          Import
        </button>
      {/if}
    </div>
  {/if}

  {#if folders}
    <div class="orden-setting">
      {@render mark('obsidian', FolderOpen)}
      <span class="name">{OBSIDIAN}</span>
      <button
        class="orden-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.obsidian()}
      >
        Import
      </button>
    </div>
  {/if}

  <div class="orden-setting">
    {@render mark('notion', FolderOpen)}
    <span class="name">{NOTION}</span>
    <button
      class="orden-chip"
      type="button"
      disabled={migrating.working}
      aria-busy={migrating.working}
      onclick={() => void migrating.files()}
    >
      Import
    </button>
  </div>

  {#if zen}
    <div class="orden-setting">
      {@render mark(ZEN_LOGO, Globe)}
      <span class="name">{ZEN}</span>
      <button
        class="orden-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.zen()}
      >
        Import
      </button>
    </div>
  {/if}

  {#each migrating.browsers as found (found.browser)}
    <div class="orden-setting">
      {@render mark(BROWSER_LOGOS[found.browser], Globe)}
      <span class="name">{found.name}</span>
      <button
        class="orden-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.browser(found)}
      >
        Import
      </button>
    </div>
  {/each}

  <div class="orden-setting">
    {@render mark(null, FolderOpen)}
    <span class="name">Another app</span>
    <span class="pair">
      <button
        class="orden-chip"
        type="button"
        disabled={migrating.working}
        aria-busy={migrating.working}
        onclick={() => void migrating.files()}
      >
        Import
      </button>
      {#if folders}
        <button
          class="orden-chip"
          type="button"
          disabled={migrating.working}
          aria-busy={migrating.working}
          onclick={() => void migrating.folder()}
        >
          Import a folder
        </button>
      {/if}
    </span>
  </div>
{/if}

{#snippet mark(slug: string | null, fallback: IconNode)}
  <span class="orden-setting-mark" aria-hidden="true"
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
