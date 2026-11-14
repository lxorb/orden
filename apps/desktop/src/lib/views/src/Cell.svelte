<script lang="ts">
  import type { Row, Value } from '@orden/bases'
  import { cellValue } from '@orden/bases'
  import { tick } from 'svelte'
  import type { Property } from '@orden/markdown/properties'
  import type { ListItem } from '@orden/markdown/property-edits'
  import PropertyValue from './PropertyValue.svelte'
  import { valueText } from './chips'
  import {
    bare,
    changeOf,
    type Editor,
    formatOf,
    holdsLists,
    isNoteProperty,
    optionsOf,
    toneOf,
  } from './columns'
  import { formatted } from './format'
  import { toneColour } from './chips'
  import { openExternal } from '../../platform/src/api'
  import type { Kit } from './kit'
  import type { ListChange } from '../../rows/src/api'
  import { isDateValue } from './values'

  const {
    row,
    property,
    editor,
    kit,
    editing = false,
    onstop,
  }: {
    row: Row
    property: string
    editor: Editor
    kit: Kit
    editing?: boolean
    onstop?: () => void
  } = $props()

  const value = $derived.by((): Value => {
    const base = kit.live.base
    return base ? cellValue(base, property, row, kit.live.context) : null
  })
  const shown = $derived(valueText(value, kit.live.today))
  const styled = $derived(
    kit.live.base ? formatted(value, formatOf(kit.live.base, property)) : null,
  )
  const chips = $derived.by(() => {
    const base = kit.live.base
    if (editor !== 'select' || !base) return null
    const values = Array.isArray(value) ? value : value === null ? [] : [value]
    return values.map((one) => {
      const words = valueText(one, kit.live.today)
      return { words, colour: toneColour(toneOf(base, property, words)) }
    })
  })
  const writable = $derived(editor !== 'none' && editor !== 'button' && kit.writes(row))

  function write(next: Value | null) {
    const change = changeOf(row, property, next)
    if (change) kit.write(row, change)
  }

  const listed = $derived(
    editor === 'list' ||
      (editor === 'select' && (Array.isArray(value) || holdsLists(property, kit.live.rows))),
  )

  const asProperty = $derived.by((): Property => {
    const items = Array.isArray(value) ? value.map((one) => valueText(one, kit.live.today)) : []
    const kind = listed
      ? 'list'
      : editor === 'number'
        ? 'number'
        : editor === 'date'
          ? 'date'
          : editor === 'checkbox'
            ? 'checkbox'
            : 'text'
    const said =
      value === null
        ? ''
        : isDateValue(value)
          ? value.iso + (value.time ? ` ${value.time.slice(0, 5)}` : '')
          : typeof value === 'boolean'
            ? String(value)
            : Array.isArray(value)
              ? ''
              : shown
    return {
      key: bare(property),
      kind,
      value: said,
      items,
      from: 0,
      to: 0,
    }
  })

  const choices = $derived(kit.live.base ? optionsOf(kit.live.base, property) : [])

  function shownMember(item: ListItem): Value {
    return item !== null && typeof item === 'object' ? item.asWritten : item
  }

  function fromWords(words: string | null): Value | null {
    if (words === null || words === '') return null
    if (editor === 'number') return Number.isFinite(Number(words)) ? Number(words) : words
    if (editor === 'checkbox') return words === 'true'
    if (editor === 'date') {
      const [day, time] = words.split(' ')
      return time ? { kind: 'date', iso: day ?? words, time } : { kind: 'date', iso: day ?? words }
    }
    return words
  }

  function stopOnKeys(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      const cell = (event.currentTarget as HTMLElement).closest<HTMLElement>('[role="gridcell"]')
      onstop?.()
      void tick().then(() => cell?.focus())
    }
  }

  function focusIt(node: HTMLElement) {
    node.focus()
    if (node instanceof HTMLInputElement && node.type === 'text') node.select()
  }
</script>

{#if editing && writable && editor !== 'checkbox'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <span
    class="editing"
    onkeydown={stopOnKeys}
    onfocusout={(event) => {
      if (!(
        event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)
      ))
        onstop?.()
    }}
  >
    {#if editor === 'time'}
      <input
        class="edit"
        type="time"
        aria-label="Time"
        value={typeof value === 'string' ? value : ''}
        use:focusIt
        onchange={(event) => write(event.currentTarget.value || null)}
      />
    {:else}
      <PropertyValue
        property={asProperty}
        writable
        choices={choices.length ? choices : null}
        autofocus
        onwrite={(words: string | null) => write(fromWords(words))}
        onitems={(items: ListItem[]) => write(items.map(shownMember))}
        onchip={isNoteProperty(property)
          ? (chip: ListChange) => kit.write(row, { list: { [bare(property)]: chip } })
          : undefined}
      />
    {/if}
  </span>
{:else if editor === 'checkbox' && typeof value === 'boolean'}
  <input
    type="checkbox"
    class="orden-checkbox"
    checked={value}
    disabled={!writable}
    aria-label={bare(property)}
    onchange={(event) => {
      write(event.currentTarget.checked)
    }}
  />
{:else if editor === 'button'}
  <button
    type="button"
    class="orden-chip press"
    disabled={!kit.writes(row)}
    onclick={(event) => {
      event.stopPropagation()
      kit.press(row, property)
    }}>{bare(property).replace(/^button\./, '')}</button
  >
{:else if chips}
  <span class="shown chips">
    {#each chips as chip, at (at)}<span class="chip" style:--tone={chip.colour}>{chip.words}</span
      >{/each}
  </span>
{:else if styled?.href}
  <a
    class="shown link"
    href={styled.href}
    onclick={(event) => {
      event.preventDefault()
      event.stopPropagation()
      if (styled.href) void openExternal(styled.href)
    }}>{styled.text}</a
  >
{:else if styled?.share !== undefined}
  <span class="shown progress">
    <span class="bar"><span class="fill" style:inline-size="{styled.share * 100}%"></span></span>
    {styled.text}
  </span>
{:else}
  <span class="shown" class:empty={!(styled?.text ?? shown)}>{styled?.text ?? shown}</span>
{/if}

<style>
  .press {
    padding: 0 var(--space-2);
    line-height: 1.6;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chips {
    display: flex;
    gap: var(--space-1);
  }

  .chip {
    flex: none;
    padding: 0 0.5em;
    border-radius: 99px;
    background: color-mix(in srgb, var(--tone, var(--muted)) 22%, transparent);
    color: var(--text-strong);
    line-height: 1.6;
  }

  .link {
    color: var(--accent);
    text-decoration: none;
  }

  .link:hover {
    text-decoration: underline;
  }

  .progress {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    font-variant-numeric: tabular-nums;
  }

  .bar {
    flex: 1;
    height: 6px;
    overflow: hidden;
    border-radius: 99px;
    background: var(--surface-press);
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: inline-size var(--dur-base) var(--ease-out);
  }

  .shown {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editing {
    display: flex;
    align-items: center;
    min-width: 0;
    width: 100%;
  }

  .edit {
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 0.15em 0.3em;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
</style>
