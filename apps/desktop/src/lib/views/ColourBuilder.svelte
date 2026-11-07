<script lang="ts">
  import { type ColourRule, colourExpression, colourRules } from '@orden/bases'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { displayName, holdsOf, knownProperties } from './columns'
  import { setViewNib } from './edit'
  import { expressionOf, type Operator, OPERATORS, rowOf, takesValue } from './filter-rows'
  import type { Kit } from './kit'
  import ToneDot from './ToneDot.svelte'
  import { propertyName } from './words'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const written = $derived(view?.orden.colour)
  const rules = $derived(colourRules(written))
  const holds = $derived(live.base ? holdsOf(live.base, live.rows) : undefined)
  const shownRules = $derived(
    (rules ?? []).map((rule) => ({ rule, shown: rowOf(rule.when, holds) })),
  )
  const kinds = $derived(view?.orden.rows ?? 'notes')
  const properties = $derived(live.base ? knownProperties(live.base, kinds, live.rows) : [])

  const OPERATOR_NAMES: Record<Operator, string> = {
    '==': '=',
    '!=': '≠',
    '<': '<',
    '>': '>',
    '<=': '≤',
    '>=': '≥',
    contains: t('contains'),
    empty: t('is empty'),
    filled: t('is not empty'),
    tag: '#',
  }

  function write(next: ColourRule[]) {
    kit.change((base, at) => setViewNib(base, at, 'colour', colourExpression(next)))
  }

  function change(at: number, rule: ColourRule) {
    write((rules ?? []).map((one, index) => (index === at ? rule : one)))
  }

  function add() {
    const property =
      kinds === 'notes'
        ? (properties.find((one) => one.startsWith('note.')) ?? 'file.name')
        : 'task.priority'
    write([...(rules ?? []), { when: expressionOf({ property, op: '==', value: '' }), tone: '1' }])
  }
</script>

{#if rules === null}
  <div class="row">
    <code class="kept">{written}</code>
    <button
      type="button"
      class="orden-glyph"
      title={t('Remove')}
      aria-label={t('Remove')}
      onclick={() => write([])}><Cross small /></button
    >
  </div>
{:else}
  {#each shownRules as { rule, shown }, at (at)}
    <div class="row">
      <ToneDot
        tone={rule.tone}
        ontone={(tone: string | null) => change(at, { ...rule, tone: tone ?? '1' })}
      />
      {#if 'kept' in shown}
        <code class="kept">{rule.when}</code>
      {:else if 'property' in shown}
        <Select
          label={t('Property')}
          value={shown.property}
          options={(properties.includes(shown.property)
            ? properties
            : [shown.property, ...properties]
          ).map((one) => ({
            value: one,
            label: propertyName(one, live.base ? displayName(live.base, one) : undefined),
          }))}
          onchange={(property: string) =>
            change(at, { ...rule, when: expressionOf({ ...shown, property }, holds) })}
        />
        <Select
          label={t('Compare')}
          value={shown.op}
          options={OPERATORS.map((one) => ({ value: one, label: OPERATOR_NAMES[one] }))}
          onchange={(op: string) => {
            const found = OPERATORS.find((one) => one === op)
            if (found) change(at, { ...rule, when: expressionOf({ ...shown, op: found }, holds) })
          }}
        />
        {#if takesValue(shown.op)}
          <input
            class="orden-field"
            value={shown.value}
            aria-label={t('Value')}
            onchange={(event) =>
              change(at, {
                ...rule,
                when: expressionOf({ ...shown, value: event.currentTarget.value }, holds),
              })}
          />
        {:else}
          <span></span>
        {/if}
      {/if}
      <button
        type="button"
        class="orden-glyph"
        title={t('Remove')}
        aria-label={t('Remove')}
        onclick={() => write(rules.filter((_, index) => index !== at))}><Cross small /></button
      >
    </div>
  {/each}

  <button type="button" class="orden-row is-short adder" onclick={add}>
    <span class="orden-row-label">{t('Add')}</span>
  </button>
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1.3fr) minmax(0, 0.8fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .kept {
    grid-column: 2 / 5;
    overflow: hidden;
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .adder .orden-row-label {
    color: var(--muted);
  }
</style>
