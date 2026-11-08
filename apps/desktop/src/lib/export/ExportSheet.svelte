<script lang="ts">
  import { exportCommands } from '../commands'
  import { t } from '../i18n.svelte'
  import Sheet from '../Sheet.svelte'
  import Switch from '../Switch.svelte'
  import { picker } from './picker.svelte'
  import { commandFor, SETUP, shelved, type Tile } from './tiles'

  const choices = $derived(picker.open ? exportCommands() : [])
  const shelves = $derived(shelved(choices, picker.last.id || null))
  const tiles = $derived(shelves.flatMap((one) => one.tiles))
  const setup = $derived(choices.find((one) => one.id === SETUP) ?? null)

  let chosenId = $derived(picker.open ? picker.last.id || null : null)
  const chosen = $derived(
    tiles.find((one) => one.id === chosenId && !one.disabled) ??
      tiles.find((one) => !one.disabled) ??
      null,
  )
  let optioned = $derived(chosen ? (picker.last.optioned[chosen.id] ?? false) : false)

  function go(tile: Tile | null) {
    if (!tile || tile.disabled) return
    const id = commandFor(tile, optioned)
    const command = choices.find((one) => one.id === id)
    if (!command) return
    picker.keep(tile.id, optioned)
    picker.close()
    command.run()
  }

  function setUp() {
    picker.close()
    setup?.run()
  }
</script>

<Sheet open={picker.open} title={t('Export')} onclose={() => picker.close()}>
  {#each shelves as shelf (shelf.id)}
    <section class="shelf" aria-label={shelf.label}>
      <h3>{shelf.label}</h3>
      <div class="tiles" role="radiogroup" aria-label={shelf.label}>
        {#each shelf.tiles as tile (tile.id)}
          <button
            type="button"
            class="tile"
            class:on={chosen?.id === tile.id}
            role="radio"
            aria-checked={chosen?.id === tile.id}
            data-format={tile.id}
            disabled={tile.disabled}
            onclick={() => (chosenId = tile.id)}
            ondblclick={() => go(tile)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {#each tile.icon as [tag, attrs], index (index)}
                <svelte:element this={tag} {...attrs} />
              {/each}
            </svg>
            <span class="name">{tile.name}</span>
          </button>
        {/each}
      </div>
    </section>
  {/each}

  {#if chosen?.option}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="orden-setting option" onclick={() => (optioned = !optioned)}>
      <span class="name">{chosen.option.label}</span>
      <Switch
        on={optioned}
        label={chosen.option.label}
        onchange={(on: boolean) => (optioned = on)}
      />
    </div>
  {/if}

  {#snippet foot()}
    {#if setup}
      <button class="orden-button is-quiet" onclick={setUp}>{setup.label}</button>
    {/if}
    <button class="orden-button go" disabled={!chosen} onclick={() => go(chosen)}>
      {t('Export')}
    </button>
  {/snippet}
</Sheet>

<style>
  .shelf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }

  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    transition:
      background var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .tile svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--muted-strong);
  }

  .tile .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tile:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .tile.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .tile.on svg {
    color: var(--accent);
  }

  .option {
    margin: 0 var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .go {
    margin-inline-start: auto;
  }

  :global([data-touch]) .go {
    flex: 1;
    justify-content: center;
  }
</style>
