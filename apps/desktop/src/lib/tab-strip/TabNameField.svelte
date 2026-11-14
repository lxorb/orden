<script lang="ts">
  import { focusEditor } from '../focus'
  import { selectAll } from '../select-all'
  import type { Tab } from '../workspace/documents.svelte'

  const { tab }: { tab: Tab } = $props()

  // svelte-ignore state_referenced_locally
  const was = tab.shown
  let typed = $state(was)

  let settled = false

  function leave(commit: boolean) {
    if (settled) return
    settled = true
    tab.naming = false

    if (commit && typed.trim() !== was.trim()) {
      void import('../terminal/src/api').then(({ renameTerminal }) => renameTerminal(tab, typed))
    }
    focusEditor()
  }
</script>

<input
  class="field"
  bind:value={typed}
  spellcheck="false"
  autocapitalize="off"
  autocorrect="off"
  enterkeyhint="done"
  aria-label="Name"
  use:selectAll
  onblur={() => leave(true)}
  onpointerdown={(event) => event.stopPropagation()}
  onkeydown={(event) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      leave(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      leave(false)
    } else if (event.key === 'Tab') {
      event.preventDefault()
    }
  }}
/>

<style>
  .field {
    position: absolute;
    top: var(--tab-top, 5px);
    bottom: var(--tab-top, 5px);
    inset-inline: calc(3px + 8px + var(--icon-md) + 6px) calc(3px + 8px + 16px + 4px);
    margin: auto 0;
    height: 1.6em;
    min-width: 0;
    padding: 0 2px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }
</style>
