<script lang="ts">
  /** A box about the answer, at the start of a question's row of answers: "Always ask"
   *  under Ctrl+N in a terminal (PromptSheet.svelte), "Don't ask again" under quitting
   *  (quitting/QuitSheet.svelte). The task list's own box (`.nib-checkbox` in the themes
   *  package) and its words on one line beside it, taking the room the answers leave.
   *  One of these, so the two never drift apart again: the prompt's was drawn as an
   *  empty pill with its words wrapped over two lines, under the sheet's rule for its
   *  text field (#317). */
  const {
    label,
    checked,
    onchange,
  }: { label: string; checked: boolean; onchange: (on: boolean) => void } = $props()
</script>

<label class="tick">
  <input
    type="checkbox"
    class="nib-checkbox"
    {checked}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />
  <span>{label}</span>
</label>

<style>
  .tick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-inline-end: auto;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--muted-strong);
    white-space: nowrap;
  }

  .tick input {
    flex: none;
    margin: 0;
  }
</style>
