<script lang="ts">
  import { BUTTON, type Button, readButtons, withButton } from '@orden/bases'
  import { appCommands } from '../commands'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'
  import Select from '../Select.svelte'
  import { bare, knownProperties } from './columns'
  import { setColumns } from './edit'
  import type { Kit } from './kit'

  const { kit, column }: { kit: Kit; column?: string | undefined } = $props()

  const live = $derived(kit.live)
  let made = $state<string | undefined>(undefined)
  const name = $derived(made ?? (column?.startsWith(BUTTON) ? column.slice(BUTTON.length) : ''))
  const button = $derived(
    live.base ? (readButtons(live.base).find((one) => one.name === name) ?? null) : null,
  )
  const keys = $derived(
    live.base
      ? knownProperties(live.base, 'notes', live.rows)
          .filter((one) => one.startsWith('note.'))
          .map(bare)
      : [],
  )
  const commands = $derived(
    appCommands()
      .filter((one) => !one.ownWindow && !one.byHand)
      .map((one) => ({ value: one.id, label: one.label })),
  )

  const blank = (): Button => ({ name, set: {}, kept: {} })

  function write(change: Partial<Button>) {
    const next = { ...(button ?? blank()), ...change }
    for (const key of ['task', 'command', 'open'] as const) {
      if (next[key] === '') Reflect.deleteProperty(next, key)
    }
    kit.change((base) => withButton(base, next.name, next))
  }

  function rename(words: string) {
    const next = words.trim()
    if (!next || next === name || !live.base) return
    if (readButtons(live.base).some((one) => one.name === next)) return
    const old = name
    const columns = live.columns.includes(`${BUTTON}${old}`)
      ? live.columns.map((one) => (one === `${BUTTON}${old}` ? `${BUTTON}${next}` : one))
      : [...live.columns, `${BUTTON}${next}`]
    const kept = { ...(button ?? blank()), name: next }
    made = next
    kit.change((base, at) =>
      setColumns(withButton(old ? withButton(base, old, null) : base, next, kept), at, columns),
    )
  }

  const sets = $derived(Object.entries(button?.set ?? {}))
</script>

<input
  class="nib-field"
  value={name}
  aria-label={t('Name')}
  placeholder={t('Button')}
  onchange={(event) => rename(event.currentTarget.value)}
/>

{#if button}
  {#each sets as [key, value], at (at)}
    <div class="row">
      <Select
        label={t('Property')}
        value={key}
        options={(keys.includes(key) ? keys : [key, ...keys]).map((one) => ({
          value: one,
          label: one,
        }))}
        onchange={(next: string) =>
          write({
            set: Object.fromEntries(sets.map(([k, v]) => (k === key ? [next, v] : [k, v]))),
          })}
      />
      <input
        class="nib-field"
        {value}
        aria-label={t('Value')}
        onchange={(event) => write({ set: { ...button.set, [key]: event.currentTarget.value } })}
      />
      <button
        type="button"
        class="nib-glyph"
        title={t('Remove')}
        aria-label={t('Remove')}
        onclick={() => write({ set: Object.fromEntries(sets.filter(([k]) => k !== key)) })}
        ><Cross small /></button
      >
    </div>
  {/each}
  <button
    type="button"
    class="nib-row is-short adder"
    onclick={() => {
      const key = keys.find((one) => !(one in button.set)) ?? 'status'
      write({ set: { ...button.set, [key]: '' } })
    }}
  >
    <span class="nib-row-label">{t('Add')}</span>
  </button>

  <input
    class="nib-field"
    value={button.task ?? ''}
    aria-label={t('Add task')}
    placeholder={t('Add task')}
    onchange={(event) => write({ task: event.currentTarget.value })}
  />
  <Select
    label={t('Command')}
    value={button.command ?? ''}
    options={[{ value: '', label: t('Command') }, ...commands]}
    onchange={(command: string) => write({ command })}
  />
  <input
    class="nib-field"
    value={button.open ?? ''}
    aria-label={t('Address')}
    placeholder="https://"
    onchange={(event) => write({ open: event.currentTarget.value })}
  />
{/if}

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .adder .nib-row-label {
    color: var(--muted);
  }
</style>
