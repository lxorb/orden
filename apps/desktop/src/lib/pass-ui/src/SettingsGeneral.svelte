<script lang="ts">
  import { hostOf } from '@orden/pass/urls'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { Select } from '../../ui-controls/src/api'
  import Glyph from './Glyph.svelte'
  import { pauseWord, type Paused, PAUSES, pass } from '../../pass-sync/src/api'
  import SwitchRow from './SwitchRow.svelte'

  const FLAGS = [
    ['autofill', 'Autofill'],
    ['autofillTotp', 'Autofill 2FA codes'],
    ['copyTotpAfterFill', 'Copy 2FA code after autofill'],
    ['suggest', 'Suggest passwords and aliases'],
    ['autosave', 'Offer to save logins'],
    ['autoLogin', 'Sign in automatically'],
    ['showUsernameField', 'Show username field'],
  ] as const
  const settings = $derived(pass.settings)
  const sites = $derived(Object.entries(settings.paused).sort(([a], [b]) => a.localeCompare(b)))
  let typed = $state('')
  function paused(site: string, change: Partial<Paused>) {
    const was = settings.paused[site]
    const blankPaused = Object.fromEntries(PAUSES.map((one) => [one, false])) as Paused
    pass.setSetting('paused', {
      ...settings.paused,
      [site]: { ...(was ?? blankPaused), ...change },
    })
  }
  function unpaused(site: string) {
    pass.setSetting('paused', Object.fromEntries(Object.entries(settings.paused).filter(([one]) => one !== site)))
  }
  function added(event: SubmitEvent) {
    event.preventDefault()
    const site = hostOf(typed.includes('://') ? typed : `https://${typed}`)
    if (!site) return
    paused(site, Object.fromEntries(PAUSES.map((one) => [one, true])))
    typed = ''
  }
</script>

<div class="pass-stack">
  {#each FLAGS as [key, label] (key)}
    <SwitchRow {label} on={settings[key]} onchange={(on: boolean) => pass.setSetting(key, on)} />
  {/each}
</div>

<div class="pass-stack">
  <div class="orden-setting row">
    <span class="name">Default vault</span>
    <Select
      label="Default vault"
      value={settings.defaultVault ?? ''}
      options={[
        { value: '', label: 'The vault you are in' },
        ...pass.vaults.map((one) => ({ value: one.id, label: one.name })),
      ]}
      onchange={(value: string) => pass.setSetting('defaultVault', value === '' ? null : value)}
    />
  </div>
</div>

<h3 class="orden-section">Excluded sites</h3>
<div class="pass-stack">
  {#each sites as [site, pausedFor] (site)}
    <div class="site">
      <div class="site-head">
        <span class="host">{site}</span>
        <button
          class="orden-glyph"
          type="button"
          aria-label="Remove {site}"
          title="Remove {site}"
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
    <input class="orden-field is-value" placeholder="example.com" aria-label="Site to exclude" bind:value={typed} />
    <button class="orden-chip" type="submit" disabled={!typed.trim()}>Exclude</button>
  </form>
</div>

<style>
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
