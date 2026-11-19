<script lang="ts">
  import { settingsWindow } from '@orden/contracts'
  import { iconChoice } from '../../icon-picker/src/api'
  import { canWriteAt, managesSpace } from '../../sharing/src/api'
  import { commitSpaceName, settingsSpace } from './api'
  import SpaceBadge from './SpaceBadge.svelte'

  const space = $derived(settingsSpace(settingsWindow().space))
  const names = $derived(space !== null && managesSpace(space.root))
  const icons = $derived(space !== null && canWriteAt(space.root))
  function commit(input: HTMLInputElement) {
    const typed = input.value.trim()
    if (!space || !names || !typed || typed === space.name) {
      input.value = space?.name ?? ''
      return
    }
    void commitSpaceName(space, typed)
  }
</script>

{#if space}
  <label class="orden-setting setting">
    <span class="name"><span class="what">Name</span></span>
    <input
      class="orden-field"
      value={space.name}
      readonly={!names}
      aria-label="Space name"
      spellcheck="false"
      autocomplete="off"
      onblur={(event) => commit(event.currentTarget)}
      onkeydown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.currentTarget.value = space.name
          event.currentTarget.blur()
        }
      }}
    />
  </label>
  <div class="orden-setting setting">
    <span class="name"><span class="what">Icon</span></span>
    <button class="orden-glyph" disabled={!icons} aria-label="Choose an icon" onclick={() => iconChoice.space(space.id)}
      ><SpaceBadge {space} /></button
    >
  </div>
{/if}
