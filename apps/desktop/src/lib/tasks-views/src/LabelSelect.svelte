<script lang="ts">
  import { tick } from 'svelte'
  import { hang, overlays } from '../../ui-kit/src/api'

  const {
    labels,
    chosen,
    onchoose,
  }: {
    labels: readonly string[]
    chosen: string | null
    onchoose: (label: string | null) => void
  } = $props()
  let open = $state(false)
  let typed = $state('')
  let field = $state<HTMLInputElement | null>(null)
  let root = $state<HTMLElement | null>(null)
  let list = $state<HTMLElement | null>(null)
  const shown = $derived.by(() => {
    const needle = typed.trim().toLowerCase()
    return labels.filter((one) => needle === '' || one.toLowerCase().includes(needle))
  })
  async function show() {
    open = true
    typed = ''
    await tick()
    field?.focus()
  }
  function choose(label: string | null) {
    onchoose(label)
    open = false
  }
  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      open = false
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const first = shown[0]
      if (first !== undefined) choose(first)
      else if (typed.trim() === '') choose(null)
    }
  }
  function away(event: FocusEvent) {
    const next = event.relatedTarget
    if (next instanceof Node && (root?.contains(next) || list?.contains(next))) return
    open = false
  }
  $effect(() =>
    open
      ? overlays.show(
          () => (open = false),
          () => [root, list],
        )
      : undefined,
  )
</script>

<div class="labels" bind:this={root} onfocusout={away}>
  <button
    type="button"
    class="pick orden-chip"
    class:is-on={chosen !== null}
    aria-haspopup="listbox"
    aria-expanded={open}
    data-todos-label
    onclick={() => (open ? (open = false) : void show())}
  >
    <span class="text">{chosen ?? 'All labels'}</span>
    <svg class="chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" /></svg>
  </button>
  {#if open}
    <div
      class="list orden-layer"
      role="listbox"
      aria-label="Label"
      data-covers
      bind:this={list}
      use:hang={{ side: 'below', gap: 4, from: root }}
      onfocusout={away}
    >
      <input
        bind:this={field}
        bind:value={typed}
        class="search orden-field"
        type="search"
        placeholder="Search labels"
        {onkeydown}
      />
      <button
        type="button"
        role="option"
        aria-selected={chosen === null}
        class="one orden-row is-short"
        class:is-on={chosen === null}
        onclick={() => choose(null)}
      >
        All labels
      </button>
      {#each shown as label (label)}
        <button
          type="button"
          role="option"
          aria-selected={chosen === label}
          class="one orden-row is-short"
          class:is-on={chosen === label}
          onclick={() => choose(label)}
        >
          {label}
        </button>
      {/each}
      {#if !shown.length}
        <p class="none">No label matches</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .labels {
    position: relative;
    min-width: 0;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    flex: none;
    width: 9px;
    height: 9px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--dur-fast) var(--ease-out);
  }
  [aria-expanded='true'] .chevron {
    transform: rotate(180deg);
  }
  .list {
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: max-content;
    min-width: 12rem;
    max-width: 20rem;
    max-height: 18rem;
    overflow: auto;
    padding: var(--space-1);
  }
  .search {
    margin-bottom: var(--space-1);
  }
  .one {
    flex: none;
  }
  .none {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    color: var(--muted);
    font-size: var(--text-sm);
  }
</style>
