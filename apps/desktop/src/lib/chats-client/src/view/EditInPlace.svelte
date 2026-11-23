<script lang="ts">
  import { untrack } from 'svelte'
  import { grow } from './grow'

  const { text, onsend, oncancel }: { text: string; onsend: (text: string) => void; oncancel: () => void } = $props()
  let words = $state(untrack(() => text))
  const empty = $derived(!words.trim())
  function focused(field: HTMLTextAreaElement) {
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }
  function send() {
    if (!empty) onsend(words)
  }
  function onKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      oncancel()
    }
  }
</script>

<div class="edit orden-field">
  <textarea
    bind:value={words}
    use:grow={words}
    use:focused
    data-entry
    rows="1"
    aria-label="Edit message"
    onkeydown={onKey}></textarea>
  <div class="actions">
    <button type="button" class="orden-button is-quiet is-soft" onclick={oncancel}>Cancel</button>
    <button type="button" class="orden-button" disabled={empty} onclick={send}>Save</button>
  </div>
</div>

<style>
  .edit {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    margin: 2px 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    cursor: text;
  }
  textarea {
    width: 100%;
    max-height: 40vh;
    min-height: 0;
    resize: none;
    line-height: 1.45;
    field-sizing: content;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
