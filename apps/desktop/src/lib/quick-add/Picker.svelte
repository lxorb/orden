<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { fade } from 'svelte/transition'
  import { LAYER } from '../motion'
  import { DIVIDER, type MenuEntry, walkableRows } from '../menu-item'
  import { spendClick } from '../spent-click'

  const {
    rows,
    at,
    onclose,
  }: {
    rows: MenuEntry[]
    at: DOMRect
    onclose: () => void
  } = $props()

  const walkable = $derived(walkableRows(rows))
  let cursor = $state(0)
  let list = $state<HTMLElement>()

  onMount(() => {
    const checked = rows.findIndex((row) => row !== DIVIDER && row.checked === true)
    cursor = Math.max(walkable.indexOf(checked), 0)
    void tick().then(() => list?.focus())
  })

  function choose(row: MenuEntry) {
    if (row === DIVIDER || row.disabled) return
    onclose()
    row.run()
  }

  function onkeydown(event: KeyboardEvent) {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (step) {
      event.preventDefault()
      cursor = (cursor + step + walkable.length) % Math.max(walkable.length, 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const row = rows[walkable[cursor] ?? -1]
      if (row !== undefined) choose(row)
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      event.stopPropagation()
      onclose()
    }
  }
</script>

<div
  class="catch"
  data-covers="all"
  role="presentation"
  onpointerdown={(event) => {
    spendClick(event)
    onclose()
  }}
></div>
<ul
  bind:this={list}
  class="nib-layer picker"
  role="menu"
  tabindex="-1"
  style:left="{at.left}px"
  style:top="{at.bottom + 4}px"
  {onkeydown}
  transition:fade={{ duration: LAYER.fade }}
>
  {#each rows as row, index (index)}
    {#if row === DIVIDER}
      <li class="rule" role="separator"></li>
    {:else}
      <li role="none">
        <button
          type="button"
          class="nib-row is-short"
          class:is-on={walkable[cursor] === index}
          role="menuitemradio"
          aria-checked={row.checked === true}
          tabindex="-1"
          disabled={row.disabled}
          onpointerenter={() => (cursor = Math.max(walkable.indexOf(index), 0))}
          onclick={() => choose(row)}
        >
          <span class="tick">{row.checked ? '✓' : ''}</span>
          <span class="nib-row-label">{row.label}</span>
        </button>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .catch {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-menu) - 1);
  }

  .picker {
    position: fixed;
    z-index: var(--z-menu);
    min-width: 180px;
    max-height: 280px;
    margin: 0;
    padding: var(--space-1);
    overflow-y: auto;
    list-style: none;
    outline: none;
  }

  .rule {
    height: 1px;
    margin: var(--space-1) var(--space-2);
    background: var(--line);
  }

  .tick {
    width: 1em;
    flex: none;
    color: var(--accent);
  }
</style>
