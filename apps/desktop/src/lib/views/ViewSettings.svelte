<script lang="ts">
  /** A view's settings, Notion's ⋯ panel in the head of a base (docs/tasks.md 5.5): the
   *  layout, how it is grouped, which rows it is of, a board's card size and columns,
   *  which properties it shows (on a board, on its cards, in that order), and the rest
   *  of what can be done to a view, which `more` names. */
  import type { CardSize, RowKinds } from '@nib/bases'
  import { t } from '../i18n.svelte'
  import type { MenuEntry } from '../menu.svelte'
  import { segmented } from '../slide'
  import { viewport } from '../viewport.svelte'
  import ArrangeBuilder from './ArrangeBuilder.svelte'
  import { CARD_SIZES, DEFAULT_SIZE } from './board'
  import { displayName, knownProperties } from './columns'
  import { setColumns, setViewNib } from './edit'
  import type { Kit } from './kit'
  import { switched } from './layout'
  import { type Layout, LAYOUTS, layoutName, layoutOf, propertyName } from './words'

  const {
    kit,
    more,
  }: {
    kit: Kit
    /** The rest of what can be done to the view, as menu rows; `event` is the press. */
    more: (event?: MouseEvent) => MenuEntry[]
  } = $props()

  const live = $derived(kit.live)
  const view = $derived(live.view)
  const layout = $derived(layoutOf(view?.type ?? 'table'))
  const kinds = $derived(view?.nib.rows ?? 'notes')
  const offered = $derived(
    LAYOUTS.filter(
      (one) =>
        (one !== 'timeline' || (!kit.compact && viewport.device !== 'phone')) &&
        (one !== 'form' || kinds === 'notes'),
    ),
  )
  const board = $derived(layout === 'kanban')
  const groups = $derived(layout === 'kanban' || layout === 'list' || layout === 'table')
  const properties = $derived(
    live.base
      ? knownProperties(live.base, kinds, live.rows).filter(
          (one) => !one.startsWith('button.') || live.columns.includes(one),
        )
      : [],
  )
  /** The view's own order first, then the properties it does not show. */
  const listed = $derived([
    ...live.columns,
    ...properties.filter((one) => !live.columns.includes(one)),
  ])

  const SIZES: Record<CardSize, string> = {
    small: t('Small'),
    medium: t('Medium'),
    large: t('Large'),
  }
  const KINDS: readonly { kind: RowKinds; label: string }[] = [
    { kind: 'notes', label: t('Notes') },
    { kind: 'tasks', label: t('Tasks') },
    { kind: 'both', label: t('Both') },
  ]

  function pick(next: Layout) {
    kit.change((one, at) => switched(one, at, next, live.rows))
  }

  function shows(property: string, on: boolean) {
    const order = on ? [...live.columns, property] : live.columns.filter((one) => one !== property)
    kit.change((one, at) => setColumns(one, at, order))
  }

  /** A property carried up or down the list of shown ones by its grip. */
  function carry(event: PointerEvent, from: string) {
    event.preventDefault()
    const list = (event.currentTarget as HTMLElement).closest('.shown')
    const up = (one: PointerEvent) => {
      window.removeEventListener('pointerup', up)
      const rows = [...(list?.querySelectorAll<HTMLElement>('[data-shown]') ?? [])]
      const to = rows.findIndex((row) => {
        const box = row.getBoundingClientRect()
        return one.clientY >= box.top && one.clientY < box.bottom
      })
      const target = rows[to]?.dataset.shown
      if (target === undefined || target === from) return
      const order = live.columns.filter((name) => name !== from)
      order.splice(order.indexOf(target) + (to > live.columns.indexOf(from) ? 1 : 0), 0, from)
      kit.change((base, at) => setColumns(base, at, order))
    }
    window.addEventListener('pointerup', up)
  }

  function toggle(on: boolean, run: () => void) {
    return {
      onclick: run,
      onkeydown: (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        run()
      },
      'aria-checked': on,
    }
  }
</script>

{#snippet setting(label: string, on: boolean, run: () => void)}
  <div class="nib-setting pressable" role="switch" tabindex="0" {...toggle(on, run)}>
    <span class="name">{label}</span>
    <span class="nib-switch" class:on aria-hidden="true"></span>
  </div>
{/snippet}

<div class="settings">
  <p class="nib-section">{t('Layout')}</p>
  <div class="layouts">
    {#each offered as one (one)}
      <button
        type="button"
        class="nib-chip"
        class:is-on={layout === one}
        aria-pressed={layout === one}
        onclick={() => pick(one)}>{layoutName(one)}</button
      >
    {/each}
  </div>

  {#if groups}
    <p class="nib-section">{t('Group')}</p>
    <ArrangeBuilder {kit} part="group" />
  {/if}

  {#if board}
    {@render setting(t('Colour columns'), view?.nib.colourColumns !== false, () =>
      kit.change((one, at) =>
        setViewNib(one, at, 'colourColumns', view?.nib.colourColumns === false ? undefined : false),
      ),
    )}
    {@render setting(t('Hide empty groups'), view?.nib.hideEmpty === true, () =>
      kit.change((one, at) =>
        setViewNib(one, at, 'hideEmpty', view?.nib.hideEmpty ? undefined : true),
      ),
    )}
    <p class="nib-section">{t('Card size')}</p>
    <div class="nib-segmented" role="radiogroup" aria-label={t('Card size')} use:segmented>
      {#each CARD_SIZES as size (size)}
        {@const on = (view?.nib.cardSize ?? DEFAULT_SIZE) === size}
        <button
          type="button"
          role="radio"
          aria-checked={on}
          class:on
          onclick={() => kit.change((one, at) => setViewNib(one, at, 'cardSize', size))}
          >{SIZES[size]}</button
        >
      {/each}
    </div>
  {/if}

  {#if kit.spec.builtin === undefined}
    <p class="nib-section">{t('Rows')}</p>
    <div class="nib-segmented" role="radiogroup" aria-label={t('Rows')} use:segmented>
      {#each KINDS as one (one.kind)}
        <button
          type="button"
          role="radio"
          aria-checked={kinds === one.kind}
          class:on={kinds === one.kind}
          onclick={() =>
            kit.change((base, at) =>
              setViewNib(base, at, 'rows', one.kind === 'notes' ? undefined : one.kind),
            )}>{one.label}</button
        >
      {/each}
    </div>
  {/if}

  <p class="nib-section">{board ? t('Shown on cards') : t('Properties')}</p>
  <div class="shown">
    {#each listed as one (one)}
      {@const on = live.columns.includes(one)}
      <div class="property" data-shown={on ? one : undefined}>
        <span
          class="grip"
          class:off={!on}
          aria-hidden="true"
          onpointerdown={(event) => on && carry(event, one)}>⠿</span
        >
        <div
          class="nib-setting pressable"
          role="switch"
          tabindex="0"
          {...toggle(on, () => shows(one, !on))}
        >
          <span class="name"
            >{propertyName(one, live.base ? displayName(live.base, one) : undefined)}</span
          >
          <span class="nib-switch" class:on aria-hidden="true"></span>
        </div>
      </div>
    {/each}
  </div>

  {#if more().some(Boolean)}
    <p class="nib-section">{t('More')}</p>
    {#each more() as entry, at (at)}
      {#if entry}
        <button
          type="button"
          class="nib-row is-short"
          class:danger={entry.danger}
          disabled={entry.disabled}
          onclick={(event) => {
            const now = more(event)[at]
            now?.run()
          }}
        >
          <span class="nib-row-label">{entry.label}</span>
          {#if entry.checked}<span class="tick" aria-hidden="true">✓</span>{/if}
        </button>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 18rem;
    max-height: min(70vh, 640px);
    overflow-y: auto;
  }

  .nib-section {
    margin: var(--space-2) 0 0;
  }

  .nib-section:first-child {
    margin-top: 0;
  }

  .layouts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .nib-segmented {
    width: 100%;
  }

  .pressable {
    cursor: default;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shown {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .property {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .property .nib-setting {
    flex: 1;
    min-width: 0;
  }

  .grip {
    color: var(--muted);
    cursor: grab;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }

  .grip.off {
    visibility: hidden;
  }

  .tick {
    margin-inline-start: auto;
    color: var(--accent);
  }

  .danger .nib-row-label {
    color: var(--danger);
  }
</style>
