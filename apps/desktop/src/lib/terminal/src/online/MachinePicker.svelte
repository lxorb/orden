<script lang="ts">
  import { Facts, prompt } from '../../../ui-kit/src/api'
  import { Select } from '../../../ui-controls/src/api'
  import { chooseType, type Offers, refitOf, type ServerInfo } from './calls'
  import {
    type Arch,
    askedOf,
    factsOf,
    type Kind,
    money,
    type Pick,
    picksOf,
    placeOf,
    refitWords,
    type Sort,
    warningOf,
  } from './choosing'

  const {
    offers,
    server,
    running,
    chosen,
  }: {
    offers: Offers
    server: ServerInfo | null
    running: number
    chosen: () => Promise<void>
  } = $props()
  const made = $derived(server?.made === true)
  let picked = $state<string | null>(null)
  const location = $derived(made ? (server?.location ?? null) : (picked ?? placeOf(offers, server)))
  let sort = $state<Sort>('price')
  let kind = $state<Kind>('any')
  let arch = $state<Arch>('any')
  let busy = $state(false)
  let said = $state<string | null>(null)
  const picks = $derived(picksOf(offers, location, sort, kind, arch, server))
  const places = $derived(offers.locations.map((one) => ({ value: one.name, label: one.city })))
  const SORTS = [
    { value: 'price', label: 'Price' },
    { value: 'cores', label: 'vCPU' },
    { value: 'memory', label: 'RAM' },
    { value: 'disk', label: 'Disk' },
    { value: 'name', label: 'Name' },
  ]
  const KINDS = [
    { value: 'any', label: 'Any CPU' },
    { value: 'shared', label: 'Shared' },
    { value: 'dedicated', label: 'Dedicated' },
  ]
  const ARCHES = [
    { value: 'any', label: 'x86 or Arm' },
    { value: 'x86', label: 'x86' },
    { value: 'arm', label: 'Arm' },
  ]
  const blockedWords = (pick: Pick) =>
    pick.blocked === 'disk' ? 'Smaller disk' : pick.blocked === 'arch' ? 'Other CPU' : null
  async function use(pick: Pick) {
    said = null
    if (server && made) {
      const warning = warningOf(running)
      if (warning && !(await prompt.confirm({ title: warning, confirmLabel: 'Continue', danger: true }))) return
      const asked = askedOf(server, pick, offers.currency)
      if (!(await prompt.confirm({ ...asked, confirmLabel: 'Resize' }))) return
    }
    busy = true
    try {
      await chooseType(pick.offer.name, made ? null : location)
      await chosen()
    } catch (error) {
      said = refitWords(refitOf(error))
    } finally {
      busy = false
    }
  }
</script>

{#snippet control(
  label: string,
  value: string,
  options: { value: string; label: string }[],
  onchange: (value: string) => void,
  disabled = false,
)}
  <div class="control">
    <span>{label}</span>
    <Select {value} {options} {disabled} {label} {onchange} />
  </div>
{/snippet}

<div class="picker">
  <div class="controls">
    {@render control('Location', location ?? '', places, (value) => (picked = value), made)}
    {@render control('Sort by', sort, SORTS, (value) => (sort = value as Sort))}
    {@render control('CPU', kind, KINDS, (value) => (kind = value as Kind))}
    {@render control('Architecture', arch, ARCHES, (value) => (arch = value as Arch))}
  </div>
  {#if made}
    <p class="hint">A made machine keeps its location. A smaller disk cannot be chosen.</p>
  {/if}
  {#if said}
    <p class="hint said" role="alert">{said}</p>
  {/if}
  <div class="types">
    {#each picks as pick (pick.offer.name)}
      {@const blocked = blockedWords(pick)}
      <div class="orden-setting setting type" data-type={pick.offer.name}>
        <span class="name">
          {pick.offer.name.toUpperCase()}
          <small><Facts parts={factsOf(pick.offer)} /></small>
        </span>
        <span class="price">
          <span>{money(pick.monthly, offers.currency)} a month</span>
          <small>{money(pick.hourly, offers.currency, true)} an hour</small>
        </span>
        <div class="row">
          {#if pick.current}
            <span class="hint">Current</span>
          {:else if blocked}
            <span class="hint">{blocked}</span>
          {:else}
            <button class="orden-chip" disabled={busy} onclick={() => void use(pick)}>{made ? 'Resize' : 'Use'}</button>
          {/if}
        </div>
      </div>
    {:else}
      <p class="hint">No machine matches</p>
    {/each}
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    width: 100%;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }
  .control {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .types {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .setting .name {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .setting small {
    font-size: var(--text-xs);
    color: var(--muted);
  }
  .price {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .row {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 5.5em;
  }
  .hint {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }
  .said {
    color: var(--text);
  }
  :global(.sheet.phone) .picker {
    padding: var(--touch-pad);
  }
  :global(.sheet.phone) .setting {
    flex-wrap: wrap;
    gap: var(--space-1) var(--touch-gap);
    min-height: var(--touch-row);
    padding: var(--space-2) 0;
    font-size: var(--touch-text);
  }
  :global(.sheet.phone) .setting .name {
    flex-basis: 100%;
  }
  :global(.sheet.phone) .price {
    flex: 1;
    align-items: flex-start;
  }
  :global(.sheet.phone) .setting small,
  :global(.sheet.phone) .hint,
  :global(.sheet.phone) .control {
    font-size: var(--text-base);
  }
</style>
