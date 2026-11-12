<script lang="ts">
  import { type Automation, readAutomations, withAutomations } from '@orden/bases'
  import Cross from '../Cross.svelte'
  import Select from '../Select.svelte'
  import { bare, knownProperties } from './columns'
  import type { Kit } from './kit'

  const { kit }: { kit: Kit } = $props()

  const live = $derived(kit.live)
  const automations = $derived(live.base ? readAutomations(live.base) : [])
  const keys = $derived(
    live.base
      ? knownProperties(live.base, 'notes', live.rows)
          .filter((one) => one.startsWith('note.'))
          .map(bare)
      : [],
  )
  const ADDED = ''

  function write(next: Automation[]) {
    kit.change((base) => withAutomations(base, next))
  }

  function change(at: number, automation: Automation) {
    write(automations.map((one, index) => (index === at ? automation : one)))
  }

  function add() {
    write([...automations, { when: { added: true }, set: {}, kept: {} }])
  }

  function said(automation: Automation, key: 'move' | 'notify', words: string): Automation {
    const next = { ...automation }
    if (words.trim()) next[key] = words.trim()
    else Reflect.deleteProperty(next, key)
    return next
  }
</script>

{#each automations as automation, at (at)}
  {@const when = automation.when}
  {@const sets = Object.entries(automation.set)}
  <div class="automation" class:off={automation.off}>
    <div class="row">
      <button
        type="button"
        class="switch"
        role="switch"
        aria-checked={!automation.off}
        aria-label="On"
        onclick={() => {
          const next = { ...automation }
          if (automation.off) Reflect.deleteProperty(next, 'off')
          else next.off = true
          change(at, next)
        }}><span class="orden-switch" class:on={!automation.off} aria-hidden="true"></span></button
      >
      <Select
        label="Automations"
        value={'added' in when ? ADDED : when.property}
        options={[
          { value: ADDED, label: 'Row added' },
          ...keys.map((one) => ({ value: one, label: one })),
        ]}
        onchange={(next: string) =>
          change(at, {
            ...automation,
            when: next === ADDED ? { added: true } : { property: next },
          })}
      />
      {#if 'property' in when}
        <input
          class="orden-field"
          value={when.is ?? ''}
          aria-label="Value"
          placeholder="="
          onchange={(event) => {
            const is = event.currentTarget.value.trim()
            change(at, {
              ...automation,
              when: is ? { property: when.property, is } : { property: when.property },
            })
          }}
        />
      {:else}
        <span></span>
      {/if}
      <button
        type="button"
        class="orden-glyph"
        title="Remove"
        aria-label="Remove"
        onclick={() => write(automations.filter((_, index) => index !== at))}
        ><Cross small /></button
      >
    </div>

    {#each sets as [key, value] (key)}
      <div class="row then">
        <span class="mark" aria-hidden="true">→</span>
        <Select
          label="Property"
          value={key}
          options={(keys.includes(key) ? keys : [key, ...keys]).map((one) => ({
            value: one,
            label: one,
          }))}
          onchange={(next: string) =>
            change(at, {
              ...automation,
              set: Object.fromEntries(sets.map(([k, v]) => (k === key ? [next, v] : [k, v]))),
            })}
        />
        <input
          class="orden-field"
          {value}
          aria-label="Value"
          onchange={(event) =>
            change(at, {
              ...automation,
              set: { ...automation.set, [key]: event.currentTarget.value },
            })}
        />
        <button
          type="button"
          class="orden-glyph"
          title="Remove"
          aria-label="Remove"
          onclick={() =>
            change(at, {
              ...automation,
              set: Object.fromEntries(sets.filter(([k]) => k !== key)),
            })}><Cross small /></button
        >
      </div>
    {/each}
    <div class="row then">
      <span class="mark" aria-hidden="true">→</span>
      <button
        type="button"
        class="orden-row is-short adder"
        onclick={() => {
          const key = keys.find((one) => !(one in automation.set)) ?? 'status'
          change(at, { ...automation, set: { ...automation.set, [key]: '' } })
        }}
      >
        <span class="orden-row-label">Add</span>
      </button>
    </div>
    <div class="row then">
      <span class="mark" aria-hidden="true">→</span>
      <input
        class="orden-field"
        value={automation.move ?? ''}
        aria-label="Move to"
        placeholder="Move to"
        onchange={(event) => change(at, said(automation, 'move', event.currentTarget.value))}
      />
      <input
        class="orden-field"
        value={automation.notify ?? ''}
        aria-label="Notifications"
        placeholder="Notifications"
        onchange={(event) => change(at, said(automation, 'notify', event.currentTarget.value))}
      />
    </div>
  </div>
{/each}

<button type="button" class="orden-row is-short adder" onclick={add}>
  <span class="orden-row-label">Add</span>
</button>

<style>
  .automation {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .automation.off {
    opacity: 0.55;
  }

  .row {
    display: grid;
    grid-template-columns: auto minmax(0, 1.2fr) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2);
  }

  .switch {
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    background: none;
  }

  .mark,
  .switch {
    width: 40px;
  }

  .mark {
    color: var(--muted);
    text-align: center;
  }

  .then .adder {
    grid-column: 2 / 4;
  }

  .adder .orden-row-label {
    color: var(--muted);
  }
</style>
