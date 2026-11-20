<script lang="ts">
  import { tick } from 'svelte'
  import { dur, fade } from '../../platform/src/api'
  import { hang, overlays } from '../../ui-kit/src/api'
  import ActivityMark from './ActivityMark.svelte'
  import { accentIdFor } from '../../theme/src/api'
  import { activityName } from './records'
  import { time } from './time.svelte'

  const {
    from,
    chosen = null,
    onpick,
    onclose,
    onmanage,
  }: {
    from: HTMLElement
    chosen?: string | null
    onpick: (activity: string) => void
    onclose: () => void
    onmanage?: (() => void) | undefined
  } = $props()
  let typed = $state('')
  let lit = $state(0)
  let field = $state<HTMLInputElement | null>(null)
  let list = $state<HTMLElement | null>(null)
  const shown = $derived.by(() => {
    const needle = typed.trim().toLocaleLowerCase()
    return time.latest().filter((one) => !needle || one.name.toLocaleLowerCase().includes(needle))
  })
  const fresh = $derived.by(() => {
    const said = activityName(typed)
    const wanted = said.toLocaleLowerCase()
    return said && !time.activities.some((one) => one.name.toLocaleLowerCase() === wanted) ? said : null
  })
  const rows = $derived(shown.length + (fresh ? 1 : 0))
  $effect(() => overlays.show(onclose, () => [list, from]))
  $effect(() => {
    void tick().then(() => field?.focus())
  })
  function pick(id: string) {
    onpick(id)
    onclose()
  }
  function create() {
    const name = fresh
    if (!name) return
    pick(time.addActivity(name, accentIdFor(name)).id)
  }
  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onclose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      lit = Math.max(0, Math.min(rows - 1, lit + (event.key === 'ArrowDown' ? 1 : -1)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const one = shown[lit] ?? (fresh ? null : shown[0])
      if (one) pick(one.id)
      else create()
    }
  }
</script>

<div
  class="layer orden-layer"
  role="listbox"
  aria-label="Activity"
  data-covers
  data-time-activities
  bind:this={list}
  use:hang={{ side: 'below', gap: 4, from }}
  transition:fade={{ duration: dur(120) }}
>
  <input
    bind:this={field}
    bind:value={typed}
    class="search orden-field"
    type="search"
    aria-label="Find an activity"
    placeholder="Activity"
    oninput={() => (lit = 0)}
    {onkeydown}
  />
  {#each shown as one, index (one.id)}
    <button
      type="button"
      role="option"
      aria-selected={one.id === chosen}
      class="orden-row is-short"
      class:is-on={one.id === chosen}
      class:lit={index === lit}
      onpointerenter={() => (lit = index)}
      onclick={() => pick(one.id)}
    >
      <ActivityMark activity={one.id} size={16} />
      <span class="orden-row-label" dir="auto">{one.name}</span>
    </button>
  {/each}
  {#if fresh}
    <button
      type="button"
      role="option"
      aria-selected="false"
      class="orden-row is-short create"
      class:lit={lit === shown.length}
      data-time-create
      onpointerenter={() => (lit = shown.length)}
      onclick={create}
    >
      <span class="plus" aria-hidden="true">+</span>
      <span class="orden-row-label" dir="auto">Create "{fresh}"</span>
    </button>
  {/if}
  {#if onmanage}
    <button
      type="button"
      class="orden-row is-short manage"
      onclick={() => {
        onclose()
        onmanage()
      }}>Manage activities</button
    >
  {/if}
</div>

<style>
  .layer {
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    gap: 1px;
    width: max-content;
    min-width: 14rem;
    max-width: 20rem;
    max-height: 20rem;
    overflow: auto;
    padding: var(--space-1);
  }
  .search {
    margin-bottom: var(--space-1);
  }
  .orden-row {
    flex: none;
  }
  .lit {
    background: var(--surface-hover);
  }
  .plus {
    flex: none;
    width: 14px;
    color: var(--accent);
    text-align: center;
  }
  .manage {
    margin-top: var(--space-1);
    border-top: 1px solid var(--line);
    border-radius: 0 0 var(--radius-row) var(--radius-row);
    color: var(--muted);
  }
</style>
