<script lang="ts">
  import SettingsAliases from './SettingsAliases.svelte'
  import SettingsExport from './SettingsExport.svelte'
  import SettingsGeneral from './SettingsGeneral.svelte'
  import SettingsImport from './SettingsImport.svelte'
  import SettingsSecurity from './SettingsSecurity.svelte'
  import { SETTINGS_TABS, type PassUi } from '../../pass-sync/src/api'

  const { ui }: { ui: PassUi } = $props()
  const TABS = {
    general: ['General', SettingsGeneral],
    security: ['Security', SettingsSecurity],
    aliases: ['Aliases', SettingsAliases],
    import: ['Import', SettingsImport],
    export: ['Export', SettingsExport],
  } as const
  const tab = $derived(ui.view.settingsTab)
  const Page = $derived(TABS[tab][1])
</script>

<section class="settings" aria-label="Settings">
  <header class="head">
    <h2 class="pass-title">Settings</h2>
    <div class="orden-segmented tabs" role="tablist" aria-label="Settings">
      {#each SETTINGS_TABS as one (one)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === one}
          class:on={tab === one}
          onclick={() => ui.show({ settingsTab: one })}
        >
          {TABS[one][0]}
        </button>
      {/each}
    </div>
  </header>

  <div class="body" data-scrolls>
    <Page />
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
