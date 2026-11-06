<script lang="ts">
  import type { Property } from '@orden/markdown/properties'
  import { type ListItem, withItem, withoutItem } from '@orden/markdown/property-edits'
  import Cross from '../Cross.svelte'
  import { t } from '../i18n.svelte'

  const {
    property,
    writable,
    choices = null,
    onwrite,
    onitems,
    onchip,
    onsearch,
    autofocus = false,
  }: {
    property: Property
    writable: boolean
    choices?: readonly string[] | null
    onwrite: (value: string | null) => void
    onitems: (items: ListItem[]) => void
    onchip?: ((change: { add: string } | { remove: number }) => void) | undefined
    onsearch?: ((text: string) => void) | undefined
    autofocus?: boolean
  } = $props()

  const uid = $props.id()

  const offered = $derived(choices?.filter((one) => !property.items.includes(one)) ?? [])

  function commitOnEnter(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur()
  }

  function dated(field: HTMLInputElement): string {
    return field.type === 'datetime-local' ? field.value.replace('T', ' ') : field.value
  }

  function fieldType(one: Property): string {
    if (one.kind === 'number') return 'number'
    if (one.kind !== 'date') return 'text'
    return one.value.length > 10 ? 'datetime-local' : 'date'
  }

  function addItem(field: HTMLInputElement) {
    const said = field.value
    field.value = ''
    if (onchip) {
      if (said.trim()) onchip({ add: said.trim() })
      return
    }
    const items = withItem(property, said)
    if (items) onitems(items)
  }

  const tagged = $derived(/^tags?$/i.test(property.key))

  function focusOnMount(node: HTMLElement) {
    if (autofocus) node.focus()
  }
</script>

<span class="value">
  {#if property.kind === 'list' || property.kind === 'map'}
    {#each property.items as item, at (`${at}:${item}`)}
      <span class="chip">
        {#if tagged && onsearch}
          <button class="chip-word" onclick={() => onsearch(`tag:${item}`)}>{item}</button>
        {:else}
          {item}
        {/if}
        {#if writable && property.kind === 'list'}
          <button
            class="chip-off"
            title={t('Remove')}
            aria-label={t('Remove')}
            onclick={() => {
              if (onchip) return onchip({ remove: at })
              const items = withoutItem(property, item)
              if (items) onitems(items)
            }}><Cross small /></button
          >
        {/if}
      </span>
    {/each}
    {#if writable && property.kind === 'list'}
      <input
        class="field add"
        placeholder={t('Add')}
        aria-label={t('Add')}
        list={offered.length ? `${uid}-offered` : undefined}
        use:focusOnMount
        onkeydown={(event) => {
          if (event.key !== 'Enter' || event.isComposing) return
          event.preventDefault()
          addItem(event.currentTarget)
        }}
        onblur={(event) => addItem(event.currentTarget)}
      />
      {#if offered.length}
        <datalist id="{uid}-offered">
          {#each offered as one (one)}<option value={one}></option>{/each}
        </datalist>
      {/if}
    {/if}
  {:else if property.kind === 'checkbox'}
    <input
      type="checkbox"
      class="nib-checkbox"
      checked={property.value.toLowerCase() === 'true'}
      disabled={!writable}
      aria-label={property.key}
      use:focusOnMount
      onchange={(event) => onwrite(event.currentTarget.checked ? 'true' : 'false')}
    />
  {:else if choices && writable}
    <select
      class="field"
      aria-label={property.key}
      value={property.value}
      use:focusOnMount
      onchange={(event) => onwrite(event.currentTarget.value || null)}
    >
      {#each choices.includes(property.value) || !property.value ? choices : [property.value, ...choices] as one (one)}
        <option value={one}>{one}</option>
      {/each}
    </select>
  {:else}
    <input
      class="field"
      type={fieldType(property)}
      value={fieldType(property) === 'datetime-local'
        ? property.value.replace(' ', 'T')
        : property.value}
      readonly={!writable}
      aria-label={property.key}
      use:focusOnMount
      onkeydown={commitOnEnter}
      onchange={(event) => onwrite(dated(event.currentTarget) || null)}
    />
  {/if}
</span>

<style>
  .value {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: var(--row-height);
    color: var(--text);
  }

  .field {
    min-width: 0;
    width: 100%;
    padding: 0.2em 0.35em;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  .field[type='number'],
  .field[type='date'],
  .field[type='datetime-local'] {
    font-variant-numeric: tabular-nums;
  }

  @media (hover: hover) {
    .field:hover:not([readonly]) {
      border-color: var(--line);
    }
  }

  .field.add {
    flex: 1 1 5em;
    width: auto;
    color: var(--muted);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25em;
    max-width: 100%;
    padding: 1px var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    color: var(--muted-strong);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }

  .chip-word,
  .chip-off {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: default;
  }

  .chip-off {
    display: grid;
    place-items: center;
    line-height: 1;
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .chip-off :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 1.4;
  }

  @media (hover: hover) {
    .chip-word:hover {
      color: var(--accent);
    }

    .chip:hover .chip-off {
      opacity: 1;
    }
  }

  .chip-off:focus-visible,
  :global([data-touch]) .chip-off {
    opacity: 1;
  }
</style>
