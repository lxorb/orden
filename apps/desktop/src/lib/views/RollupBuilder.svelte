<script lang="ts">
  import { readReverse, readRollup, type Rollup, ROLLUPS, rollupFormula } from '@orden/bases'
  import { Select } from '../ui-controls/src/api'
  import { relationsOf } from './columns'
  import { freeFormulaName, setColumns, setFormula } from './edit'
  import type { Kit } from './kit'
  import { propertyName, summaryName } from './words'

  const { kit, column }: { kit: Kit; column?: string | undefined } = $props()

  const live = $derived(kit.live)
  const base = $derived(live.base)
  let made = $state<string | undefined>(undefined)
  const target = $derived(made ?? column)
  const editing = $derived(
    target?.startsWith('formula.') && base ? (base.formulas[target.slice(8)] ?? null) : null,
  )
  const was = $derived(editing === null ? null : readRollup(editing))

  const relations = $derived([
    ...Object.entries(base?.formulas ?? {})
      .filter(([, source]) => readReverse(source) !== null)
      .map(([name]) => ({ value: `formula.${name}`, label: `← ${name}` })),
    ...relationsOf(live.answer?.groups.flatMap((group) => group.rows) ?? []).map((one) => ({
      value: one,
      label: propertyName(one),
    })),
  ])

  const keys = $derived.by(() => {
    const seen: Record<string, true> = {}
    for (const row of live.rows) {
      if (row.kind !== 'note') continue
      for (const key of Object.keys(row.note)) seen[key] = true
      if (Object.keys(seen).length > 200) break
    }
    return Object.keys(seen).sort()
  })

  const NAMES: Record<Rollup, string> = {
    count: 'Count',
    filled: summaryName('Filled'),
    unique: summaryName('Unique'),
    sum: summaryName('Sum'),
    average: summaryName('Average'),
    median: summaryName('Median'),
    min: summaryName('Min'),
    max: summaryName('Max'),
    range: summaryName('Range'),
    checked: summaryName('Checked'),
    percent: 'Percent ticked',
  }

  let relation = $state('')
  let property = $state('')
  let calc = $state<Rollup>('count')
  $effect(() => {
    relation = was?.relation ?? relations[0]?.value ?? ''
    property = was?.property ?? ''
    calc = was?.calc ?? 'count'
  })

  const autoName = (spec: { relation: string; property?: string | undefined; calc: Rollup }) =>
    [propertyName(spec.relation), spec.property, NAMES[spec.calc]].filter(Boolean).join(' ')

  function write() {
    if (!relation || !base) return
    const spec =
      property && calc !== 'count'
        ? { relation, property, calc }
        : { relation, calc: 'count' as const }
    const source = rollupFormula(spec)
    const old = target?.startsWith('formula.') && editing !== null ? target.slice(8) : null
    if (old !== null && (was === null || old !== autoName(was))) {
      kit.change((one) => setFormula(one, old, source))
      return
    }
    const without = old === null ? base : setFormula(base, old, null)
    const name = freeFormulaName(without, autoName(spec))
    made = `formula.${name}`
    const columns =
      old === null
        ? [...live.columns, `formula.${name}`]
        : live.columns.map((one) => (one === `formula.${old}` ? `formula.${name}` : one))
    kit.change((one, at) =>
      setColumns(
        setFormula(old === null ? one : setFormula(one, old, null), name, source),
        at,
        columns,
      ),
    )
  }
</script>

<div class="rows">
  <Select
    label="Rollup"
    value={relation}
    options={relations}
    onchange={(next: string) => {
      relation = next
      write()
    }}
  />
  <Select
    label="Property"
    value={property}
    options={[{ value: '', label: 'Notes' }, ...keys.map((one) => ({ value: one, label: one }))]}
    onchange={(next: string) => {
      property = next
      if (!next) calc = 'count'
      write()
    }}
  />
  <Select
    label="Summary"
    value={calc}
    options={(property ? ROLLUPS : (['count'] as const)).map((one) => ({
      value: one,
      label: NAMES[one],
    }))}
    onchange={(next: string) => {
      const found = ROLLUPS.find((one) => one === next)
      if (found) calc = found
      write()
    }}
  />
</div>

<style>
  .rows {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
  }
</style>
