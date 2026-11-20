<script lang="ts">
  import { tick } from 'svelte'
  import { hang, overlays } from '../../ui-kit/src/api'

  interface Choice {
    value: string
    label: string
  }
  const {
    name,
    label,
    value,
    options,
    first,
    search,
    on = false,
    onchange,
    ...rest
  }: {
    name?: string
    label: string
    value: string
    options: readonly Choice[]
    first?: Choice
    search?: string
    on?: boolean
    onchange: (next: string) => void
    [key: `data-${string}`]: string | boolean
  } = $props()
  let open = $state(false)
  let typed = $state('')
  let field = $state<HTMLInputElement | null>(null)
  let root = $state<HTMLElement | null>(null)
  let list = $state<HTMLElement | null>(null)
  const shown = $derived.by(() => {
    const needle = typed.trim().toLowerCase()
    return options.filter((one) => needle === '' || one.label.toLowerCase().includes(needle))
  })
  const current = $derived((first?.value === value ? first : options.find((one) => one.value === value))?.label)
  async function show() {
    open = true
    typed = ''
    await tick()
    if (field) field.focus()
    else list?.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus()
  }
  function choose(next: string) {
    onchange(next)
    open = false
  }
  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      open = false
    } else if (event.key === 'Enter' && event.target === field) {
      event.preventDefault()
      const top = shown[0]
      if (top) choose(top.value)
      else if (first && typed.trim() === '') choose(first.value)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = [...(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
      const at = rows.indexOf(document.activeElement as HTMLElement)
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (!next) return
      event.preventDefault()
      next.focus()
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

<div class="chip-pick" bind:this={root} onfocusout={away}>
  <button
    type="button"
    class="pick orden-chip"
    class:is-on={on}
    role="combobox"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={label}
    {...rest}
    onclick={() => (open ? (open = false) : void show())}
  >
    {#if name}<span class="name">{name}</span>{/if}
    <span class="text">{current ?? ''}</span>
    <svg class="chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3" /></svg>
  </button>
  {#if open}
    <div
      class="list orden-layer"
      role="listbox"
      aria-label={label}
      data-covers
      bind:this={list}
      use:hang={{ side: 'below', gap: 4, from: root }}
      onfocusout={away}
    >
      {#if search !== undefined}
        <input
          bind:this={field}
          bind:value={typed}
          class="search orden-field"
          type="search"
          placeholder={search}
          {onkeydown}
        />
      {/if}
      {#each first ? [first, ...shown] : shown as one (one.value)}
        <button
          type="button"
          role="option"
          aria-selected={value === one.value}
          class="one orden-row is-short"
          class:is-on={value === one.value}
          onclick={() => choose(one.value)}
          {onkeydown}
        >
          {one.label}
        </button>
      {/each}
      {#if search !== undefined && !shown.length}
        <p class="none">No {label.toLowerCase()} matches</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chip-pick {
    position: relative;
    min-width: 0;
  }
  .pick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
  }
  .name {
    color: var(--muted);
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
