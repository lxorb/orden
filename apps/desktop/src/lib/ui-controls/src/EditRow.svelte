<script lang="ts">
  import type { Snippet } from 'svelte'
  import Hint from './Hint.svelte'

  const {
    label,
    value,
    empty = 'Not set',
    hint,
    word = 'Edit',
    disabled = false,
    onedit,
    lead,
  }: {
    label: string
    value: string | null
    empty?: string
    hint?: string
    word?: string
    disabled?: boolean
    onedit?: (() => void) | undefined
    lead?: Snippet
  } = $props()
</script>

<div class="orden-setting setting">
  {#if lead}{@render lead()}{/if}
  <span class="name"
    ><span class="what"
      >{label}{#if hint}<Hint text={hint} />{/if}</span
    ></span
  >
  <span class="end">
    <span class="text" class:empty={!value?.trim()}>{value?.trim() ? value : empty}</span>
    {#if onedit}
      <button class="orden-chip" aria-label="{word} {label.toLowerCase()}" {disabled} onclick={onedit}>{word}</button>
    {/if}
  </span>
</div>

<style>
  .end {
    display: flex;
    flex: 3 1 0;
    justify-content: flex-end;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .end button {
    flex: none;
  }
  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted-strong);
  }
  .empty {
    color: var(--muted);
  }
</style>
