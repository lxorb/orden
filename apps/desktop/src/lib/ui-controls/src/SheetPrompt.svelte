<script lang="ts">
  import { prompt } from '../../ui-kit/src/api'
  import BottomSheet from './BottomSheet.svelte'

  let field = $state<HTMLInputElement | null>(null)
  const typing = $derived(prompt.mode === 'text' || prompt.mode === 'find')
  const needle = $derived(prompt.value.trim().toLocaleLowerCase())
  const options = $derived(
    prompt.mode === 'find'
      ? prompt.options.filter((one) => !needle || one.label.toLocaleLowerCase().includes(needle))
      : prompt.mode === 'choose'
        ? prompt.options
        : [],
  )
  $effect(() => {
    if (prompt.open && typing) field?.focus({ preventScroll: true })
  })
  function sent(event: Event) {
    event.preventDefault()
    prompt.submit()
  }
</script>

<BottomSheet open={prompt.open} label={prompt.title} onclose={() => prompt.dismiss()}>
  <form class="prompt" onsubmit={sent} data-sheet-prompt={prompt.mode}>
    <h2 class="title">{prompt.title}</h2>
    {#if prompt.detail}<p class="detail">{prompt.detail}</p>{/if}
    {#if typing}
      <input
        bind:this={field}
        class="orden-field"
        aria-label={prompt.title}
        placeholder={prompt.placeholder}
        enterkeyhint={prompt.mode === 'text' ? 'done' : 'search'}
        bind:value={prompt.value}
      />
    {/if}
    {#each options as one (one.id)}
      <button
        type="button"
        class="orden-row"
        class:is-danger={one.danger}
        data-sheet-option={one.id}
        onclick={() => prompt.pick(one.id)}>{one.label}</button
      >
    {/each}
    <div class="acts">
      <button type="button" class="orden-button is-quiet" onclick={() => prompt.dismiss()}>Cancel</button>
      {#if prompt.mode === 'text' || prompt.mode === 'confirm'}
        <button
          type="submit"
          class="orden-button"
          class:is-danger={prompt.danger}
          disabled={prompt.mode === 'text' && !prompt.value.trim()}
          data-sheet-confirm>{prompt.confirmLabel}</button
        >
      {/if}
    </div>
  </form>
</BottomSheet>

<style>
  .prompt {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .detail {
    margin: 0;
    color: var(--muted);
  }
  .prompt :global(input),
  .prompt :global(button) {
    min-height: var(--touch-target);
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .acts button {
    min-width: 5.5rem;
  }
</style>
