<script lang="ts">
  import SettingsAliases from './SettingsAliases.svelte'
  import SettingsExport from './SettingsExport.svelte'
  import SettingsGeneral from './SettingsGeneral.svelte'
  import SettingsImport from './SettingsImport.svelte'
  import SettingsSecurity from './SettingsSecurity.svelte'
  import type { PassUi } from '../../pass-sync/src/api'
  import { SETTINGS_TABS, type SettingsTab } from '../../pass-sync/src/api'

  const { ui }: { ui: PassUi } = $props()

  const tab = $derived(ui.view.settingsTab)

  function tabName(one: SettingsTab): string {
    switch (one) {
      case 'general':
        return 'General'
      case 'security':
        return 'Security'
      case 'aliases':
        return 'Aliases'
      case 'import':
        return 'Import'
      case 'export':
        return 'Export'
    }
  }
</script>

<section class="settings" aria-label="Settings">
  <header class="head">
    <h2 class="title">Settings</h2>
    <div class="orden-segmented tabs" role="tablist" aria-label="Settings">
      {#each SETTINGS_TABS as one (one)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === one}
          class:on={tab === one}
          onclick={() => ui.show({ settingsTab: one })}
        >
          {tabName(one)}
        </button>
      {/each}
    </div>
  </header>

  <div class="body" data-scrolls>
    {#if tab === 'general'}
      <SettingsGeneral />
    {:else if tab === 'security'}
      <SettingsSecurity />
    {:else if tab === 'aliases'}
      <SettingsAliases />
    {:else if tab === 'import'}
      <SettingsImport />
    {:else}
      <SettingsExport />
    {/if}
  </div>
</section>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .head {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5) var(--space-3);
  }

  .title {
    margin: 0;
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .tabs {
    max-width: 36rem;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 40rem;
    padding: 0 var(--space-5) var(--space-6);
  }
</style>
