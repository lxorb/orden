<script lang="ts">
  import { cellValue, compile, GLOBALS } from '@orden/bases'
  import { valueText } from './chips'
  import { knownProperties } from './columns'
  import { freeFormulaName, setColumns, setFormula } from './edit'
  import type { Kit } from './kit'

  const { kit, column }: { kit: Kit; column?: string | undefined } = $props()

  const EXAMPLE = 'pages > 400'

  const live = $derived(kit.live)
  const base = $derived(live.base)
  let made = $state<string | undefined>(undefined)
  const name = $derived(made ?? (column?.startsWith('formula.') ? column.slice(8) : undefined))

  let typed = $derived(name !== undefined ? (base?.formulas[name] ?? '') : '')
  let caret = $state(0)

  const reads = $derived.by(() => {
    if (!typed.trim()) return true
    try {
      compile(typed)
      return true
    } catch {
      return false
    }
  })

  const preview = $derived.by(() => {
    const first = live.answer?.groups.find((group) => group.rows.length)?.rows[0]
    if (!base || !first || !typed.trim() || !reads) return ''
    const trial = setFormula(base, '__preview__', typed)
    return valueText(cellValue(trial, 'formula.__preview__', first, live.context), live.today)
  })

  const word = $derived(/[\w.]*$/.exec(typed.slice(0, caret))?.[0] ?? '')
  const offers = $derived.by(() => {
    if (!base || word.length < 1) return []
    const known = [
      ...knownProperties(base, live.view?.orden.rows ?? 'notes', live.rows),
      ...[...GLOBALS].map((one) => `${one}()`),
    ]
    const lower = word.toLowerCase()
    return known.filter((one) => one.toLowerCase().includes(lower) && one !== word).slice(0, 8)
  })

  let field = $state<HTMLInputElement>()

  function take(offer: string) {
    const before = typed.slice(0, caret - word.length)
    const after = typed.slice(caret)
    typed = `${before}${offer}${after}`
    caret = before.length + offer.length - (offer.endsWith('()') ? 1 : 0)
    queueMicrotask(() => {
      field?.focus()
      field?.setSelectionRange(caret, caret)
    })
  }

  function write() {
    if (!base || !typed.trim() || !reads) return
    const source = typed.trim()
    if (name !== undefined) {
      kit.change((one) => setFormula(one, name, source))
      return
    }
    const fresh = freeFormulaName(base, 'Formula')
    made = fresh
    const columns = [...live.columns, `formula.${fresh}`]
    kit.change((one, at) => setColumns(setFormula(one, fresh, source), at, columns))
  }

  function rename(words: string) {
    const next = words.trim()
    if (!base || name === undefined || !next || next === name) return
    const fresh = freeFormulaName(setFormula(base, name, null), next)
    const source = base.formulas[name] ?? typed
    const old = name
    made = fresh
    const columns = live.columns.map((one) => (one === `formula.${old}` ? `formula.${fresh}` : one))
    kit.change((one, at) =>
      setColumns(setFormula(setFormula(one, old, null), fresh, source), at, columns),
    )
  }
</script>

{#if name !== undefined}
  <input
    class="orden-field"
    value={name}
    aria-label="Name"
    onchange={(event) => rename(event.currentTarget.value)}
  />
{/if}
<input
  bind:this={field}
  class="orden-field expression"
  class:wrong={!reads}
  value={typed}
  aria-label="Formula"
  placeholder={EXAMPLE}
  spellcheck="false"
  oninput={(event) => {
    typed = event.currentTarget.value
    caret = event.currentTarget.selectionStart ?? typed.length
  }}
  onkeyup={(event) => (caret = event.currentTarget.selectionStart ?? typed.length)}
  onchange={write}
  onkeydown={(event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      write()
    }
  }}
/>
{#if offers.length}
  <div class="offers">
    {#each offers as offer (offer)}
      <button
        type="button"
        class="orden-chip offer"
        onmousedown={(event) => event.preventDefault()}
        onclick={() => take(offer)}>{offer}</button
      >
    {/each}
  </div>
{/if}
{#if preview}
  <p class="preview">= {preview}</p>
{/if}

<style>
  .expression {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .expression.wrong {
    border-color: var(--danger);
  }

  .offers {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .offer {
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .preview {
    margin: 0;
    overflow: hidden;
    color: var(--muted-strong);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
