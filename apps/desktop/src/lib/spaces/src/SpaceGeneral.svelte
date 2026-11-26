<script lang="ts">
  import { settingsWindow } from '@orden/contracts'
  import { iconChoice } from '../../icon-picker/src/api'
  import { canWriteAt, managesSpace } from '../../sharing/src/api'
  import { commitSpaceName, settingsSpace } from './api'
  import SpaceBadge from './SpaceBadge.svelte'
  import { EditRow, EditSheet } from '../../ui-controls/src/api'

  const space = $derived(settingsSpace(settingsWindow().space))
  const names = $derived(space !== null && managesSpace(space.root))
  const icons = $derived(space !== null && canWriteAt(space.root))
  let editing = $state(false)
  let typed = $state('')
  function edit() {
    typed = space?.name ?? ''
    editing = true
  }
  function save() {
    const name = typed.trim()
    editing = false
    if (space && names && name && name !== space.name) void commitSpaceName(space, name)
  }
</script>

{#if space}
  <EditRow label="Name" value={space.name} onedit={names ? edit : undefined} />
  <EditSheet open={editing} title="Rename space" ready={!!typed.trim()} onsave={save} onclose={() => (editing = false)}>
    <label
      >Name<input
        class="orden-field"
        bind:value={typed}
        aria-label="Space name"
        spellcheck="false"
        autocomplete="off"
        data-lands
      /></label
    >
  </EditSheet>
  <div class="orden-setting setting">
    <span class="name"><span class="what">Icon</span></span>
    <button class="orden-glyph" disabled={!icons} aria-label="Choose an icon" onclick={() => iconChoice.space(space.id)}
      ><SpaceBadge {space} /></button
    >
  </div>
{/if}
