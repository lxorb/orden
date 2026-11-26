<script lang="ts">
  import type { Snippet } from 'svelte'
  import Sheet from './Sheet.svelte'

  const {
    open,
    title,
    busy = false,
    ready = true,
    wrong = null,
    word = 'Save',
    onsave,
    onclose,
    children,
  }: {
    open: boolean
    title: string
    busy?: boolean
    ready?: boolean
    wrong?: string | null
    word?: string
    onsave?: (() => void) | undefined
    onclose: () => void
    children: Snippet
  } = $props()
  let form = $state<HTMLFormElement>()
</script>

<Sheet {open} {title} {onclose} width="420px">
  <form
    class="fields"
    bind:this={form}
    onsubmit={(event) => {
      event.preventDefault()
      if (ready && !busy) onsave?.()
    }}
  >
    {@render children()}
    {#if wrong}<p class="wrong">{wrong}</p>{/if}
  </form>
  {#snippet foot()}
    <span class="gap"></span>
    <button class="orden-button is-quiet" type="button" onclick={onclose}>{onsave ? 'Cancel' : 'Done'}</button>
    {#if onsave}
      <button class="orden-button" type="button" disabled={!ready || busy} onclick={() => form?.requestSubmit()}
        >{word}</button
      >
    {/if}
  {/snippet}
</Sheet>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
  }
  .gap {
    flex: 1;
  }
  .fields :global(label) {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }
</style>
