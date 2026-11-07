<script lang="ts">
  import { t } from '../i18n.svelte'
  import SettingsAliases from './SettingsAliases.svelte'
  import SettingsExport from './SettingsExport.svelte'
  import SettingsGeneral from './SettingsGeneral.svelte'
  import SettingsImport from './SettingsImport.svelte'
  import SettingsSecurity from './SettingsSecurity.svelte'
  import type { PassUi } from './ui.svelte'
  import { SETTINGS_TABS, type SettingsTab } from './view'

  const { ui }: { ui: PassUi } = $props()

  const tab = $derived(ui.view.settingsTab)

  function tabName(one: SettingsTab): string {
    switch (one) {
      case 'general':
        return t('General')
      case 'security':
        return t('Security')
      case 'aliases':
        return t('Aliases')
      case 'import':
        return t('Import')
      case 'export':
        return t('Export')
    }
  }
</script>

<section class="settings" aria-label={t('Settings')}>
  <header class="head">
    <h2 class="title">{t('Settings')}</h2>
    <div class="orden-segmented tabs" role="tablist" aria-label={t('Settings')}>
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
