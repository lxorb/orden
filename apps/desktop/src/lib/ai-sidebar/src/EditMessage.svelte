<script lang="ts">
  import { untrack } from 'svelte'
  import { grow } from './grow'

  const { text, onsend, oncancel }: { text: string; onsend: (text: string) => void; oncancel: () => void } = $props()
  let words = $state(untrack(() => text))
  const empty = $derived(!words.trim())
  function focused(field: HTMLTextAreaElement) {
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
    field.scrollIntoView({ block: 'nearest' })
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
    <button class="orden-button is-quiet is-soft" onclick={oncancel}>Cancel</button>
    <button class="orden-button" disabled={empty} onclick={send}>Send</button>
  </div>
</div>

<style>
  .edit {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    background: var(--ink-wash);
    cursor: text;
  }
  textarea {
    width: 100%;
    max-height: 50vh;
    min-height: 0;
    resize: none;
    line-height: 1.5;
    field-sizing: content;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  :global([data-touch]) textarea {
    font-size: var(--text-base);
  }
</style>
