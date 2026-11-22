<script lang="ts">
  import { onMount } from 'svelte'
  import { keptInstructions } from '../../ai-chat/src/api'

  interface Kept {
    readonly text: string
    set(text: string): void
  }
  const SETTLE = 500
  let kept = $state.raw<Kept | null>(null)
  let draft = $state('')
  let editing = false
  let timer: ReturnType<typeof setTimeout> | undefined
  onMount(() => {
    void keptInstructions().then((door) => {
      kept = door.instructionsKept
      draft = door.instructionsKept.text
    })
    return () => {
      if (timer !== undefined) keepDraft()
    }
  })
  $effect(() => {
    const text = kept?.text ?? ''
    if (!editing) draft = text
  })
  function keepDraft() {
    clearTimeout(timer)
    timer = undefined
    kept?.set(draft)
  }
  function typed(text: string) {
    draft = text
    clearTimeout(timer)
    timer = setTimeout(keepDraft, SETTLE)
  }
  function clear() {
    draft = ''
    keepDraft()
  }
</script>

<h3>Custom instructions</h3>
<div class="card">
  <div class="orden-setting setting tall">
    <label class="name" for="ai-standing">Sent to the AI with every chat</label>
    {#if draft}
      <button class="orden-chip" onclick={clear}>Clear</button>
    {/if}
    <textarea
      id="ai-standing"
      class="orden-field is-value"
      rows="4"
      placeholder="For example: keep explanations short and concise."
      value={draft}
      disabled={!kept}
      onfocus={() => (editing = true)}
      oninput={(event) => typed(event.currentTarget.value)}
      onblur={() => {
        editing = false
        keepDraft()
      }}></textarea>
  </div>
</div>

<style>
  h3 {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--muted-strong);
  }
  .card {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .tall {
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding-block: var(--space-2);
  }
  .name {
    flex: 1;
  }
  textarea {
    flex: 1 0 100%;
    min-height: 6rem;
  }
</style>
