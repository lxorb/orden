<script lang="ts">
  import { onMount } from 'svelte'
  import { nameOf, within } from '../../platform/src/api'
  import { renameMany } from './changes'
  import { inASpace } from './open'
  import { clashing, renamedAll } from './renaming'
  import type { ExplorerView } from './view.svelte'

  const {
    view,
    paths,
    onclose,
  }: { view: ExplorerView; paths: readonly string[]; onclose: () => void } = $props()

  let find = $state('')
  let replace = $state('')
  let numbered = $state(false)
  let first = $state<HTMLInputElement>()

  const names = $derived(paths.map((one) => nameOf(one)))
  const next = $derived(renamedAll(names, { find, replace, numbered }))
  const listed = $derived(
    paths.map((one) =>
      view.search ? (within(view.search.root, one) ?? nameOf(one)) : nameOf(one),
    ),
  )
  const clashes = $derived(clashing(listed, next, view.names, !inASpace(view.listing?.path ?? '')))
  const changed = $derived(next.some((name, at) => name !== names[at]))

  onMount(() => {
    first?.focus()
  })

  async function apply() {
    if (!changed || clashes.size) return
    const pairs = paths.map((from, at) => ({ from, name: next[at] ?? nameOf(from) }))
    onclose()
    await renameMany(view, pairs)
  }

  function onkey(event: KeyboardEvent) {
    if (event.key === 'Escape') onclose()
    else if (
      event.key === 'Enter' &&
      event.target instanceof HTMLInputElement &&
      event.target.type === 'text'
    )
      void apply()
    else return
    event.preventDefault()
    event.stopPropagation()
  }
</script>

<div
  class="many"
  role="dialog"
  aria-modal="true"
  aria-label="Rename"
  tabindex="-1"
  onkeydown={onkey}
>
  <div class="fields">
    <label>
      <span>Find</span>
      <input
        bind:this={first}
        bind:value={find}
        class="orden-field"
        type="text"
        spellcheck="false"
      />
    </label>
    <label>
      <span>Replace with</span>
      <input bind:value={replace} class="orden-field" type="text" spellcheck="false" />
    </label>
    <label class="tick">
      <input type="checkbox" bind:checked={numbered} />
      <span>Add numbers</span>
    </label>
  </div>
  <ol class="names">
    {#each names as name, at (paths[at])}
      <li class:is-wrong={clashes.has(at)}>
        <span class="was">{name}</span>
        <span class="now">{next[at]}</span>
      </li>
    {/each}
  </ol>
  <div class="buttons">
    <button type="button" class="orden-button is-quiet" onclick={onclose}>Cancel</button>
    <button
      type="button"
      class="orden-button"
      disabled={!changed || clashes.size > 0}
      onclick={apply}>Rename</button
    >
  </div>
</div>

<style>
  .many {
    position: absolute;
    inset: var(--space-4);
    z-index: var(--z-raised);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    font-size: var(--text-sm);
  }

  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    align-items: end;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--muted-strong);
  }

  .tick {
    flex-direction: row;
    align-items: center;
  }

  .names {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .names li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }

  .was {
    color: var(--muted);
    overflow-wrap: anywhere;
    unicode-bidi: isolate;
  }

  .now {
    color: var(--text-strong);
    overflow-wrap: anywhere;
    unicode-bidi: isolate;
  }

  .buttons {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }
</style>
