<script lang="ts">
  import { tick } from 'svelte'

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
    if (next instanceof Node && root?.contains(next)) return
    open = false
  }
</script>

<div class="labels" bind:this={root} onfocusout={away}>
  <button
    type="button"
    class="pick"
    aria-haspopup="listbox"
    aria-expanded={open}
    data-todos-label
    onclick={() => (open ? (open = false) : void show())}
  >
    {chosen ?? 'All labels'}
  </button>
  {#if open}
    <div class="list" role="listbox" aria-label="Label">
      <input
        bind:this={field}
        bind:value={typed}
        class="search"
        type="search"
        placeholder="Search labels"
        {onkeydown}
      />
      <button
        type="button"
        role="option"
        aria-selected={chosen === null}
        class="one"
        class:on={chosen === null}
        onclick={() => choose(null)}
      >
        All labels
      </button>
      {#each shown as label (label)}
        <button
          type="button"
          role="option"
          aria-selected={chosen === label}
          class="one"
          class:on={chosen === label}
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
    max-width: 100%;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .list {
    position: absolute;
    inset-inline-start: 0;
    top: calc(100% + var(--space-1));
    z-index: var(--z-popover);
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 12rem;
    max-width: 20rem;
    max-height: 18rem;
    overflow: auto;
    padding: var(--space-1);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .search {
    margin-bottom: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
  }

  .one {
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
  }

  .one:hover,
  .one:focus-visible {
    background: var(--surface-hover);
  }

  .one.on {
    background: var(--surface-selected);
  }

  .none {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    color: var(--muted);
    font-size: var(--text-sm);
  }
</style>
