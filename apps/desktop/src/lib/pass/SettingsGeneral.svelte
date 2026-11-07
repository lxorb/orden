<script lang="ts">
  import { hostOf } from '@orden/pass/urls'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import Glyph from './Glyph.svelte'
  import { pauseWord } from './settings-words'
  import { type Paused, PAUSES } from './settings'
  import { pass } from './store.svelte'
  import SwitchRow from './SwitchRow.svelte'

  type Flag =
    | 'autofill'
    | 'autofillTotp'
    | 'copyTotpAfterFill'
    | 'suggest'
    | 'autosave'
    | 'autoLogin'
    | 'showUsernameField'

  const FLAGS: { key: Flag; label: () => string }[] = [
    { key: 'autofill', label: () => t('Autofill') },
    { key: 'autofillTotp', label: () => t('Autofill 2FA codes') },
    { key: 'copyTotpAfterFill', label: () => t('Copy 2FA code after autofill') },
    { key: 'suggest', label: () => t('Suggest passwords and aliases') },
    { key: 'autosave', label: () => t('Offer to save logins') },
    { key: 'autoLogin', label: () => t('Sign in automatically') },
    { key: 'showUsernameField', label: () => t('Show username field') },
  ]

  const settings = $derived(pass.settings)
  const sites = $derived(Object.entries(settings.paused).sort(([a], [b]) => a.localeCompare(b)))
  let typed = $state('')

  function flag(key: Flag, on: boolean) {
    pass.setSetting(key, on)
  }

  function paused(site: string, change: Partial<Paused>) {
    const was = settings.paused[site]
    const blankPaused = Object.fromEntries(PAUSES.map((one) => [one, false])) as Paused
    pass.setSetting('paused', {
      ...settings.paused,
      [site]: { ...(was ?? blankPaused), ...change },
    })
  }

  function unpaused(site: string) {
    pass.setSetting(
      'paused',
      Object.fromEntries(Object.entries(settings.paused).filter(([one]) => one !== site)),
    )
  }

  function added(event: SubmitEvent) {
    event.preventDefault()
    const site = hostOf(typed.includes('://') ? typed : `https://${typed}`)
    if (!site) return
    paused(site, Object.fromEntries(PAUSES.map((one) => [one, true])))
    typed = ''
  }
</script>

<div class="card">
  {#each FLAGS as one (one.key)}
    <SwitchRow
      label={one.label()}
      on={settings[one.key]}
      onchange={(on: boolean) => flag(one.key, on)}
    />
  {/each}
</div>

<div class="card">
  <div class="orden-setting row">
    <span class="name">{t('Default vault')}</span>
    <Select
      label={t('Default vault')}
      value={settings.defaultVault ?? ''}
      options={[
        { value: '', label: t('The vault you are in') },
        ...pass.vaults.map((one) => ({ value: one.id, label: one.name })),
      ]}
      onchange={(value: string) => pass.setSetting('defaultVault', value === '' ? null : value)}
    />
  </div>
</div>

<h3 class="orden-section">{t('Excluded sites')}</h3>
<div class="card">
  {#each sites as [site, pausedFor] (site)}
    <div class="site">
      <div class="site-head">
        <span class="host">{site}</span>
        <button
          class="orden-glyph"
          type="button"
          aria-label={t('Remove {site}', { site })}
          title={t('Remove {site}', { site })}
          onclick={() => unpaused(site)}
        >
          <Glyph icon={X} />
        </button>
      </div>
      <div class="pauses">
        {#each PAUSES as pause (pause)}
          <SwitchRow
            label={pauseWord(pause)}
            on={!pausedFor[pause]}
            onchange={(on: boolean) => paused(site, { [pause]: !on })}
          />
        {/each}
      </div>
    </div>
  {/each}
  <form class="add" onsubmit={added}>
    <input
      class="orden-field is-value"
      placeholder="example.com"
      aria-label={t('Site to exclude')}
      bind:value={typed}
    />
    <button class="orden-chip" type="submit" disabled={!typed.trim()}>{t('Exclude')}</button>
  </form>
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .row {
    padding: var(--space-1) var(--space-3);
  }

  .site + .site,
  .site + .add {
    border-top: 1px solid var(--line);
  }

  .site-head {
    display: flex;
    align-items: center;
    padding: var(--space-2) var(--space-2) 0 var(--space-3);
  }

  .host {
    flex: 1;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    font-size: var(--text-row);
  }

  .pauses {
    padding-inline-start: var(--space-3);
  }

  .add {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .orden-section {
    margin: var(--space-3) 0 0;
  }
</style>
