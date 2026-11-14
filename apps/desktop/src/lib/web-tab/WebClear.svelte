<script lang="ts">
  import Select from '../Select.svelte'
  import Sheet from '../Sheet.svelte'
  import { message } from '../message'
  import { isDesktop } from '../platform/src/api'
  import { viewport } from '../viewport.svelte'
  import { clearData, DEFAULT_RANGE, type Range } from './clearing'

  const {
    apart,
    onclose,
  }: {
    apart: readonly (string | null)[]
    onclose: () => void
  } = $props()

  let range = $state<Range>(DEFAULT_RANGE)
  let history = $state(true)
  let site = $state(isDesktop)
  let cache = $state(isDesktop)
  let busy = $state(false)
  let wrong = $state<string | null>(null)

  const RANGES: { value: Range; label: () => string }[] = [
    { value: 'quarter', label: () => 'Last 15 minutes' },
    { value: 'hour', label: () => 'Last hour' },
    { value: 'day', label: () => 'Last 24 hours' },
    { value: 'week', label: () => 'Last 7 days' },
    { value: 'month', label: () => 'Last 4 weeks' },
    { value: 'all', label: () => 'All time' },
  ]

  const kinds = $derived([
    { label: 'Browsing history', on: history, set: (on: boolean) => (history = on) },
    ...(isDesktop
      ? [
          {
            label: 'Cookies and other site data',
            on: site,
            set: (on: boolean) => (site = on),
          },
          { label: 'Cached images and files', on: cache, set: (on: boolean) => (cache = on) },
        ]
      : []),
  ])

  function portal(node: HTMLElement) {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  async function go() {
    busy = true
    wrong = null
    try {
      await clearData({ range, history, site, cache }, apart)
      onclose()
    } catch (error) {
      wrong = message(error, 'the data could not be deleted')
    } finally {
      busy = false
    }
  }
</script>

<div class="holder" use:portal>
  <Sheet open title="Delete browsing data" {onclose}>
    {#if wrong}<p class="wrong">{wrong}</p>{/if}

    <div class="card">
      <div class="row">
        <span class="name">Time range</span>
        <div class="pick">
          <Select
            value={range}
            options={RANGES.map((one) => ({ value: one.value, label: one.label() }))}
            onchange={(value: string) => {
              const chosen = RANGES.find((one) => one.value === value)
              if (chosen) range = chosen.value
            }}
            label="Time range"
            plain={viewport.touch}
          />
        </div>
      </div>
    </div>

    <div class="card">
      {#each kinds as kind (kind.label)}
        <div
          class="row pressable"
          role="switch"
          tabindex="0"
          aria-checked={kind.on}
          onclick={() => kind.set(!kind.on)}
          onkeydown={(event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return
            event.preventDefault()
            kind.set(!kind.on)
          }}
        >
          <span class="name">{kind.label}</span>
          <span class="orden-switch" class:on={kind.on} aria-hidden="true"></span>
        </div>
      {/each}
    </div>

    {#snippet foot()}
      <button class="orden-button is-quiet" onclick={onclose}>Cancel</button>
      <button
        class="orden-button is-danger"
        disabled={busy || !(history || site || cache)}
        onclick={() => void go()}
      >
        Delete data
      </button>
    {/snippet}
  </Sheet>
</div>

<style>
  .holder {
    display: contents;
  }

  .pick {
    flex: none;
    width: 11rem;
  }

  .pressable {
    cursor: default;
    border-radius: var(--radius-row);
    padding-inline: var(--space-1);
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .pressable:hover {
      background: var(--surface-hover);
    }
  }

  .pressable:active {
    background: var(--surface-press);
  }

  .holder :global(.foot) {
    justify-content: flex-end;
  }
</style>
