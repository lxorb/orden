<script lang="ts">
  import { tick } from 'svelte'
  import ActivityMark from './ActivityMark.svelte'
  import { accentIdFor } from '../../theme/src/api'
  import { activityName } from './records'
  import { time } from './time.svelte'

  const {
    chosen = null,
    placeholder = 'Activity',
    limit = null,
    recent = null,
    focus = true,
    onpick,
    onescape,
  }: {
    chosen?: string | null
    placeholder?: string
    limit?: number | null
    recent?: string | null
    focus?: boolean
    onpick: (activity: string) => void
    onescape: () => void
  } = $props()
  let typed = $state('')
  let lit = $state(0)
  let field = $state<HTMLInputElement | null>(null)
  const needle = $derived(typed.trim().toLocaleLowerCase())
  const shown = $derived.by(() => {
    const found = time.latest().filter((one) => !needle || one.name.toLocaleLowerCase().includes(needle))
    return limit !== null && !needle ? found.slice(0, limit) : found
  })
  const fresh = $derived.by(() => {
    const said = activityName(typed)
    const wanted = said.toLocaleLowerCase()
    return said && !time.activities.some((one) => one.name.toLocaleLowerCase() === wanted) ? said : null
  })
  const rows = $derived(shown.length + (fresh ? 1 : 0))
  $effect(() => {
    if (focus) void tick().then(() => field?.focus())
  })
  function pick(id: string) {
    typed = ''
    lit = 0
    onpick(id)
  }
  function create() {
    const name = fresh
    if (name) pick(time.addActivity(name, accentIdFor(name)).id)
  }
  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (typed) typed = ''
      else onescape()
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

<label class="orden-field search">
  <svg class="orden-field-mark" viewBox="0 0 13 13" aria-hidden="true"
    ><path d="M5.5 1.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM8.6 8.6l3 3" /></svg
  >
  <input
    bind:this={field}
    bind:value={typed}
    type="search"
    aria-label="Find an activity"
    {placeholder}
    oninput={() => (lit = 0)}
    {onkeydown}
  />
</label>
{#if recent && !needle && shown.length}
  <p class="orden-section recent">{recent}</p>
{/if}
{#each shown as one, index (one.id)}
  <button
    type="button"
    role="option"
    aria-selected={one.id === chosen}
    class="orden-row is-short"
    class:is-on={one.id === chosen}
    class:lit={index === lit && (needle !== '' || focus)}
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

<style>
  .search {
    flex: none;
    margin-bottom: var(--space-1);
  }
  .search input::-webkit-search-cancel-button {
    display: none;
  }
  .orden-row {
    flex: none;
  }
  .lit {
    background: var(--surface-hover);
  }
  .recent {
    margin-top: var(--space-2);
  }
  .plus {
    flex: none;
    width: 16px;
    color: var(--accent);
    text-align: center;
  }
</style>
