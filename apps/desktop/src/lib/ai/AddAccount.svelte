<script lang="ts">
  import { Sheet } from '../ui-controls/src/api'
  import {
    type Adding,
    type Maker,
    keyed,
    makersOf,
    ROAD_HINTS,
    ROAD_NAMES,
    roadsOf,
  } from './add-paths'
  import ProviderMark from './ProviderMark.svelte'
  import { KIND_NAMES, type ProviderKind } from './providers'

  interface Props {
    open: boolean
    offered: readonly ProviderKind[]
    onadd: (adding: Adding) => Promise<string | null>
    onclose: () => void
  }

  const { open, offered, onadd, onclose }: Props = $props()

  const EXAMPLE_URL = 'http://localhost:11434'

  let maker = $state<Maker | null>(null)
  let road = $state<ProviderKind | null>(null)
  let typed = $state('')
  let name = $state('')
  let baseUrl = $state('')
  let busy = $state(false)
  let trouble = $state('')

  const makers = $derived(makersOf(offered))
  const roads = $derived(maker ? roadsOf(maker, offered) : [])
  const hint = $derived(road ? ROAD_HINTS[road] : '')
  const brand = $derived(makers.find((one) => one.id === maker) ?? null)

  const ready = $derived(
    !!road && !busy && (road === 'compatible' ? !!baseUrl.trim() : !keyed(road) || !!typed.trim()),
  )

  $effect(() => {
    if (open) return
    maker = null
    road = null
    clear()
  })

  function clear() {
    typed = ''
    name = ''
    baseUrl = ''
    trouble = ''
  }

  function choose(one: Maker) {
    maker = one
    const offeredRoads = roadsOf(one, offered)
    road = offeredRoads.length === 1 ? (offeredRoads[0] ?? null) : null
    clear()
  }

  function back() {
    trouble = ''
    if (road && roads.length > 1) {
      road = null
      clear()
      return
    }
    maker = null
    road = null
    clear()
  }

  async function add() {
    if (!road || !ready) return
    busy = true
    trouble = ''
    const said = await onadd({
      kind: road,
      key: typed.trim(),
      name: name.trim(),
      baseUrl: baseUrl.trim(),
    }).finally(() => (busy = false))
    if (said === null) onclose()
    else trouble = said
  }
</script>

{#snippet badge()}
  {#if brand}<ProviderMark account={{ kind: brand.mark, name: '' }} />{/if}
{/snippet}

<Sheet {open} title="Add an AI account" width="30rem" {...brand ? { mark: badge } : {}} {onclose}>
  {#if !maker}
    <div class="tiles" data-step="maker">
      {#each makers as one (one.id)}
        <button type="button" class="tile" data-maker={one.id} onclick={() => choose(one.id)}>
          <ProviderMark account={{ kind: one.mark, name: '' }} />
          <span class="tile-name">{one.name}</span>
        </button>
      {/each}
    </div>
  {:else if !road}
    <div class="roads" data-step="road">
      {#each roads as one (one)}
        <button type="button" class="road" data-road={one} onclick={() => (road = one)}>
          <ProviderMark account={{ kind: one, name: '' }} />
          <span class="tile-name">{ROAD_NAMES[one]}</span>
        </button>
      {/each}
    </div>
  {:else}
    <form
      class="fields"
      data-step="connect"
      data-road={road}
      onsubmit={(event) => {
        event.preventDefault()
        void add()
      }}
    >
      {#if hint}
        <p class="tile-hint">{hint}</p>
      {/if}
      {#if road === 'compatible'}
        <label class="field">
          <span>Name</span>
          <input
            class="orden-field"
            bind:value={name}
            placeholder={KIND_NAMES.compatible}
            spellcheck="false"
          />
        </label>
        <label class="field">
          <span>Base URL</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="orden-field"
            bind:value={baseUrl}
            placeholder={EXAMPLE_URL}
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            autofocus
          />
        </label>
      {/if}
      {#if keyed(road)}
        <label class="field">
          <span>API key</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="orden-field"
            type="password"
            bind:value={typed}
            placeholder={road === 'compatible' ? 'Optional' : road === 'gemini' ? 'AIza' : 'sk-'}
            spellcheck="false"
            autocomplete="off"
            autofocus={road !== 'compatible'}
          />
        </label>
      {/if}
      {#if trouble}<p class="wrong">{trouble}</p>{/if}
      <div class="actions">
        <button type="button" class="orden-button is-quiet" onclick={back}>Back</button>
        <button type="submit" class="orden-button" disabled={!ready}>
          {road === 'chatgpt' ? 'Continue with ChatGPT' : 'Add'}
        </button>
      </div>
    </form>
  {/if}

  {#if maker && !road}
    <div class="actions">
      <button type="button" class="orden-button is-quiet" onclick={back}>Back</button>
    </div>
  {/if}
</Sheet>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(9rem, 100%), 1fr));
    gap: var(--space-3);
    padding: 0 var(--space-2);
  }

  .tile,
  .road {
    --mark: var(--icon-lg);

    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--bg);
    color: var(--text);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .tile {
    flex-direction: column;
    align-items: flex-start;
    min-height: 6rem;
  }

  .road {
    align-items: center;
    gap: var(--space-3);
  }

  .tile:hover,
  .road:hover {
    border-color: var(--accent-line);
    background: var(--surface-hover);
  }

  .roads,
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }

  .tile-name {
    font-weight: var(--weight-strong);
    color: var(--text-strong);
  }

  .tile-hint {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) 0;
  }
</style>
