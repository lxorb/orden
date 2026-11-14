<script lang="ts">
  import { fromTodoist } from '@orden/bases'
  import { region } from '../../platform/src/api'
  import { Cross } from '../../ui-kit/src/api'
  import { Select } from '../../ui-controls/src/api'
  import { displayName, holdsOf, knownProperties } from './columns'
  import { setFilter, setShowCompleted } from './edit'
  import {
    type FilterRow,
    type FilterRows,
    filterOf,
    type Operator,
    OPERATORS,
    rowsOf,
    takesValue,
  } from './filter-rows'
  import type { Kit } from './kit'
  import { propertyName } from './words'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const holds = $derived(live.base ? holdsOf(live.base, live.rows) : undefined)
  const rows = $derived(rowsOf(view?.filters, holds))
  const kinds = $derived(view?.orden.rows ?? 'notes')
  const properties = $derived(live.base ? knownProperties(live.base, kinds, live.rows) : [])

  let typed = $state('')
  const EXAMPLE = 'today & #work | overdue'

  const OPERATOR_NAMES: Record<Operator, string> = {
    '==': '=',
    '!=': '≠',
    '<': '<',
    '>': '>',
    '<=': '≤',
    '>=': '≥',
    contains: 'contains',
    empty: 'is empty',
    filled: 'is not empty',
    tag: '#',
  }

  function write(next: FilterRows) {
    kit.change((base, at) => setFilter(base, at, filterOf(next, holds)))
  }

  function changeRow(at: number, row: FilterRow) {
    write({ ...rows, rows: rows.rows.map((one, index) => (index === at ? row : one)) })
  }

  function add() {
    const property =
      kinds === 'notes'
        ? (properties.find((one) => one.startsWith('note.')) ?? 'file.name')
        : 'task.due'
    write({ ...rows, rows: [...rows.rows, { property, op: '==', value: '' }] })
  }

  function readTyped() {
    const words = typed.trim()
    if (!words) return
    try {
      const [first] = fromTodoist(words, { lang: region(), today: live.today })
      if (first !== undefined) {
        kit.change((base, at) => setFilter(base, at, first))
        typed = ''
      }
    } catch {
      // Words Todoist's grammar cannot read stay in the field to be corrected.
    }
  }

  const describe = (filter: unknown): string =>
    typeof filter === 'string' ? filter : JSON.stringify(filter)
</script>

<div class="orden-field query">
  <input
    bind:value={typed}
    aria-label="Filter"
    placeholder={EXAMPLE}
    onkeydown={(event) => {
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        readTyped()
      }
    }}
  />
</div>

{#if kinds !== 'notes'}
  <button
    type="button"
    class="orden-chip completed"
    class:is-on={view?.orden.showCompleted === true}
    aria-pressed={view?.orden.showCompleted === true}
    onclick={() =>
      kit.change((base, at) => setShowCompleted(base, at, view?.orden.showCompleted !== true))}
    >Show completed</button
  >
{/if}

{#if rows.rows.length > 1}
  <div class="orden-segmented join" role="tablist">
    <button
      type="button"
      role="tab"
      class:on={rows.join === 'and'}
      aria-selected={rows.join === 'and'}
      onclick={() => write({ ...rows, join: 'and' })}>All</button
    >
    <button
      type="button"
      role="tab"
      class:on={rows.join === 'or'}
      aria-selected={rows.join === 'or'}
      onclick={() => write({ ...rows, join: 'or' })}>Any of them</button
    >
  </div>
{/if}

{#each rows.rows as row, at (at)}
  <div class="row">
    {#if 'kept' in row}
      <code class="kept">{describe(row.kept)}</code>
    {:else if 'property' in row}
      <Select
        label="Property"
        value={row.property}
        options={(properties.includes(row.property)
          ? properties
          : [row.property, ...properties]
        ).map((one) => ({
          value: one,
          label: propertyName(one, live.base ? displayName(live.base, one) : undefined),
        }))}
        onchange={(property: string) => changeRow(at, { ...row, property })}
      />
      <Select
        label="Compare"
        value={row.op}
        options={OPERATORS.map((one) => ({ value: one, label: OPERATOR_NAMES[one] }))}
        onchange={(op: string) => {
          const found = OPERATORS.find((one) => one === op)
          if (found) changeRow(at, { ...row, op: found })
        }}
      />
      {#if takesValue(row.op)}
        <input
          class="orden-field value"
          value={row.value}
          aria-label="Value"
          onchange={(event) => changeRow(at, { ...row, value: event.currentTarget.value })}
        />
      {/if}
    {/if}
    <button
      type="button"
      class="orden-glyph"
      title="Remove"
      aria-label="Remove"
      onclick={() => write({ ...rows, rows: rows.rows.filter((_, index) => index !== at) })}
      ><Cross small /></button
    >
  </div>
{/each}

<button type="button" class="orden-row is-short adder" onclick={add}>
  <span class="orden-row-label">Add a filter</span>
</button>

<style>
  .query input {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .completed {
    align-self: flex-start;
  }

  .join {
    align-self: flex-start;
  }

  .join button {
    padding: 0 var(--space-3);
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.8fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .kept {
    grid-column: 1 / 4;
    overflow: hidden;
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    min-width: 0;
  }

  .adder .orden-row-label {
    color: var(--muted);
  }
</style>
