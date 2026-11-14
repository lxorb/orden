<script lang="ts">
  import type { FieldKind, Section } from '@orden/pass/types'
  import { Cross } from '../../ui-kit/src/api'
  import AddField from './AddField.svelte'
  import FieldsEdit from './FieldsEdit.svelte'
  import { newField } from '../../pass-sync/src/api'
  import { newSection } from '../../pass-sync/src/api'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let { sections = $bindable(), oninput }: { sections: Section[]; oninput: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  function addSection() {
    sections = [...sections, newSection('New section')]
    oninput()
  }

  function removeSection(id: string) {
    sections = sections.filter((one) => one.id !== id)
    oninput()
  }
</script>

{#each sections as section (section.id)}
  <div class="section">
    <div class="head orden-edit-row">
      <input
        class="name"
        bind:value={section.name}
        placeholder="Section name"
        aria-label="Section name"
        {oninput}
      />
      <button
        type="button"
        class="orden-glyph"
        aria-label="Remove section"
        title="Remove section"
        onclick={() => removeSection(section.id)}
      >
        <Cross />
      </button>
    </div>
    {#if section.fields.length}
      <div class="card">
        <FieldsEdit bind:fields={section.fields} {oninput} />
      </div>
    {/if}
    <AddField
      onadd={(kind: FieldKind) => {
        section.fields = [...section.fields, newField(kind)]
        oninput()
      }}
    />
  </div>
{/each}
<button type="button" class="orden-button is-quiet is-soft add" onclick={addSection}>
  Add section
</button>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-block: 2px;
    padding-inline-start: var(--space-3);
  }

  .name {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .name:focus {
    color: var(--text-strong);
  }

  .card {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }

  .card > :global(* + *) {
    border-top: 1px solid var(--line);
  }

  .orden-glyph :global(.orden-cross) {
    width: var(--icon-lg);
    height: var(--icon-lg);
    stroke-width: 1.5;
  }

  .add {
    align-self: flex-start;
    font-size: var(--text-sm);
  }
</style>
